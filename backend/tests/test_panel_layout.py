"""Panel layout: deterministic geometry, azimuth rotation, capacity math."""
from app.geospatial.panels import (
    compass_direction,
    compute_panel_layout,
    derive_row_spacing_m,
    recommend_orientation,
)

# ~40 m x ~30 m roof near Kolkata.
ROOF = {
    "type": "Polygon",
    "coordinates": [[[88.3639, 22.5726], [88.3643, 22.5726], [88.3643, 22.5729], [88.3639, 22.5729], [88.3639, 22.5726]]],
}


def test_panel_count_capacity_math():
    r = compute_panel_layout(ROOF, panel_width_m=2.28, panel_height_m=1.13, wattage_w=550.0,
                             row_spacing_m=0.6, setback_m=0.5, tilt_deg=18.0, azimuth_deg=180.0)
    assert r.panel_count >= 0
    assert r.capacity_kwp == round(r.panel_count * 550.0 / 1000.0, 2)


def test_panels_inside_usable_and_no_overlap():
    from shapely.geometry import shape
    from app.geospatial.geometry import polygon_from_geometry, to_metric, get_centroid_wgs84
    r = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=180.0)
    assert r.panel_count > 0
    geom = polygon_from_geometry(ROOF)
    c = get_centroid_wgs84(geom)
    usable = to_metric(geom, c[0], c[1]).buffer(-0.5)
    panels = [to_metric(shape(f["geometry"]), c[0], c[1]) for f in r.footprints]
    for p in panels:
        assert usable.contains(p)
    for i in range(len(panels)):
        for j in range(i + 1, len(panels)):
            assert panels[i].intersection(panels[j]).area < 1e-6


def test_azimuth_changes_orientation():
    a = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=180.0)
    b = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=90.0)
    assert a.optimization_metadata["azimuth_deg"] != b.optimization_metadata["azimuth_deg"]
    coords_a = sorted([tuple(map(tuple, f["geometry"]["coordinates"][0])) for f in a.footprints])
    coords_b = sorted([tuple(map(tuple, f["geometry"]["coordinates"][0])) for f in b.footprints])
    assert coords_a != coords_b


def test_compass_conversion():
    assert compass_direction(180) == "South"
    assert compass_direction(0) == "North"
    assert compass_direction(90) == "East"
    assert compass_direction(135) == "South-East"
    assert compass_direction(270) == "West"


def test_row_spacing_derived_not_blind():
    s_low = derive_row_spacing_m(1.13, 5.0)
    s_high = derive_row_spacing_m(1.13, 30.0)
    assert s_high > s_low
    assert s_low >= 0.3


def test_recommend_orientation_northern_hemisphere():
    rec = recommend_orientation(22.5)
    assert rec["azimuth_deg"] == 180.0
    assert 5.0 <= rec["tilt_deg"] <= 30.0


def test_target_capacity_trims_but_never_invents():
    full = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=180.0)
    assert full.panel_count > 2
    trimmed = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=180.0,
                                   target_capacity_kwp=1.0)
    # 1 kW / 550 W -> 2 panels
    assert trimmed.panel_count == 2
    assert trimmed.capacity_kwp == round(2 * 550.0 / 1000.0, 2)
    # Impossible target keeps geometry maximum and warns.
    huge = compute_panel_layout(ROOF, tilt_deg=18.0, azimuth_deg=180.0,
                                target_capacity_kwp=1000.0)
    assert huge.panel_count == full.panel_count
    assert any("cannot be fully met" in w for w in huge.warnings)


def test_panel_defaults_are_domestic_preset():
    r = compute_panel_layout(ROOF)
    assert r.assumptions["panel_width_m"] == 2.28
    assert r.assumptions["panel_height_m"] == 1.13
    assert r.assumptions["wattage_w"] == 550.0
