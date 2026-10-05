"""Solar performance estimates using pvlib and the PVGIS TMY dataset."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class SolarEstimate:
    annual_kwh: float | None
    specific_yield_kwh_kwp: float | None
    poa_kwh_m2: float | None
    selected: dict
    candidates: list[dict]
    confidence: str
    resource_provider: str
    assumptions: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _load_tmy(latitude: float, longitude: float) -> pd.DataFrame | None:
    try:
        from pvlib.iotools import get_pvgis_tmy

        result = get_pvgis_tmy(latitude, longitude)
        data = result[0] if isinstance(result, tuple) else result
        # Normalise a few possible column names to ghi/dni/dhi/temp_air/wind_speed
        rename = {}
        for col in data.columns:
            low = col.lower()
            if low in ("g(h)", "g(h)_ep", "ghi"):
                rename[col] = "ghi"
            elif low in ("gb(n)", "gb(n)_ep", "dni", "eb(n)", "eb(n)_ep"):
                rename[col] = "dni"
            elif low in ("gd(h)", "gd(h)_ep", "dhi"):
                rename[col] = "dhi"
            elif low.startswith("t2m"):
                rename[col] = "temp_air"
            elif low.startswith("ws10m"):
                rename[col] = "wind_speed"
        data = data.rename(columns=rename)
        if not {"ghi", "dni", "dhi"}.issubset(data.columns):
            return None
        if "temp_air" not in data.columns:
            data["temp_air"] = 25.0
        if "wind_speed" not in data.columns:
            data["wind_speed"] = 1.0
        return data
    except Exception:
        return None


def _simulate(tmy: pd.DataFrame, latitude: float, longitude: float, kwp: float, tilt: float, azimuth: float) -> tuple[float, float]:
    import pvlib

    tz = "UTC"  # TMY from PVGIS is tz-naive/UTC in pvlib wrapper; treat as UTC and normalise below.
    index = tmy.index
    if getattr(index, "tz", None) is None:
        index = index.tz_localize("UTC")
        tmy = tmy.copy()
        tmy.index = index
    site = pvlib.location.Location(latitude, longitude, tz=tz if index.tz else None)
    solarposition = site.get_solarposition(tmy.index)
    poa = pvlib.irradiance.get_total_irradiance(
        surface_tilt=tilt,
        surface_azimuth=azimuth,
        solar_zenith=solarposition["apparent_zenith"],
        solar_azimuth=solarposition["azimuth"],
        dni=tmy["dni"],
        ghi=tmy["ghi"],
        dhi=tmy["dhi"],
        model="isotropic",
    )
    poa_global = poa["poa_global"].clip(lower=0)
    params = pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS["sapm"]["open_rack_glass_glass"]
    temp_cell = pvlib.temperature.sapm_cell(poa_global, tmy["temp_air"], tmy["wind_speed"], **params)
    pdc = pvlib.pvsystem.pvwatts_dc(poa_global, temp_cell, pdc0=kwp * 1000.0, gamma_pdc=-0.004)
    pac = pvlib.inverter.pvwatts(pdc, pdc0=kwp * 1000.0)
    annual_kwh = float(pac.sum()) / 1000.0
    poa_kwh_m2 = float(poa_global.sum()) / 1000.0
    return annual_kwh, poa_kwh_m2


def estimate_solar(
    latitude: float,
    longitude: float,
    capacity_kwp: float,
    tilts: list[float] | None = None,
    azimuths: list[float] | None = None,
) -> SolarEstimate:
    tilts = tilts or [0, 10, 15, 18, 20, 25, 30]
    azimuths = azimuths or [90, 135, 180, 225, 270]

    tmy = _load_tmy(latitude, longitude)
    resource_provider = "PVGIS TMY (Europe/joint research centre service)" if tmy is not None else "none"

    if tmy is None:
        # Honest fallback benchmark: typical India GHI benchmark used in public reports.
        benchmark_ghi = 5.0  # kWh/m2/day, widely cited long-term average for most of India
        assumptions = {
            "benchmark_ghi_kwh_m2_day": benchmark_ghi,
            "performance_ratio": 0.78,
            "note": "Weather-year data could not be retrieved; this uses a documented regional benchmark instead of simulation.",
        }
        best_tilt = min(tilts, key=lambda t: abs(t - max(latitude * 0.9, 5)))
        best_az = 180.0
        # Benchmark-only: specific annual yield assumes a typical Indian GHI and no fancy tilt gain curve.
        annual = benchmark_ghi * 365 * capacity_kwp * 0.78
        candidates = [
            {
                "tilt_deg": t,
                "azimuth_deg": 180,
                "annual_kwh": round(benchmark_ghi * 365 * capacity_kwp * 0.78, 0),
                "note": "benchmark-only",
            }
            for t in tilts
        ]
        return SolarEstimate(
            annual_kwh=round(annual, 0),
            specific_yield_kwh_kwp=round(annual / max(capacity_kwp, 1e-9), 0),
            poa_kwh_m2=round(benchmark_ghi * 365, 0),
            selected={"tilt_deg": best_tilt, "azimuth_deg": best_az},
            candidates=candidates,
            confidence="low",
            resource_provider="documented benchmark (no live weather-year data)",
            assumptions=assumptions,
            warnings=[
                "PVGIS data was unavailable. The number above uses a 5.0 kWh/m²/day benchmark and a 0.78 performance ratio; treat it as orientation guidance, not a bankable estimate."
            ],
        )

    candidates = []
    for tilt in tilts:
        for azimuth in azimuths:
            try:
                annual, poa = _simulate(tmy, latitude, longitude, capacity_kwp, tilt, azimuth)
                candidates.append({"tilt_deg": tilt, "azimuth_deg": azimuth, "annual_kwh": round(annual, 0), "poa_kwh_m2": round(poa, 0)})
            except Exception:
                continue
    if not candidates:
        return SolarEstimate(
            annual_kwh=None,
            specific_yield_kwh_kwp=None,
            poa_kwh_m2=None,
            selected={},
            candidates=[],
            confidence="low",
            resource_provider=resource_provider,
            warnings=["Annual simulation failed for all candidates."],
        )
    best = max(candidates, key=lambda c: c["annual_kwh"])
    specific = best["annual_kwh"] / max(capacity_kwp, 1e-9)
    warnings = []
    if latitude < 0:
        warnings.append("Site is in the southern hemisphere; preferred azimuth is around 0°.")
    return SolarEstimate(
        annual_kwh=best["annual_kwh"],
        specific_yield_kwh_kwp=round(specific, 0),
        poa_kwh_m2=best["poa_kwh_m2"],
        selected={"tilt_deg": best["tilt_deg"], "azimuth_deg": best["azimuth_deg"]},
        candidates=candidates,
        confidence="medium",
        resource_provider="PVGIS TMY (PVGIS v5.x, single weather year sample)",
        assumptions={
            "inverter_model": "PVWatts",
            "temperature_model": "SAPM open rack",
            "irradiance_transposition": "Isotropic sky",
            "losses": "temperature + DC wiring implied by PVWatts 4%/K; no soiling or shading losses included here",
        },
        warnings=warnings,
    )
