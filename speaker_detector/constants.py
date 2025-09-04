# speaker_detector/constants.py

BACKEND_VERSION = "0.2.0"

# API base paths (optional, for future centralization)
API_PREFIX = "/api"

# Default tuning values for live detection
# Centralize here so UI and routes can stay in sync
DEFAULT_CONFIDENCE_THRESHOLD = 0.75
DEFAULT_INTERVAL_MS = 3000
DEFAULT_WINDOW_S = 1.25
DEFAULT_UNKNOWN_STREAK_LIMIT = 2
DEFAULT_HOLD_TTL_S = 4.0

# Enrollment guidance
# Recommended minimum to get a solid initial voice print.
# Adjust here to tune UX globally.
DEFAULT_ENROLL_CLIP_DURATION_S = 7  # seconds per clip
DEFAULT_ENROLL_TARGET_CLIPS = 7     # number of clips to collect
