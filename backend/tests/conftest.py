import os

# Ensure tests never read a developer's real .env secrets or hit live providers by accident.
os.environ.setdefault("GEOCODER_PROVIDER", "nominatim")
