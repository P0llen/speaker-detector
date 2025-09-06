# speaker_detector/constants.py

BACKEND_VERSION = "0.2.3"

# API base paths (optional, for future centralization)
API_PREFIX = "/api"

# Default tuning values for live detection
# Centralize here so UI and routes can stay in sync
DEFAULT_CONFIDENCE_THRESHOLD = 0.75
DEFAULT_INTERVAL_MS = 4000        # align cadence with recommended window
DEFAULT_WINDOW_S = 4.0            # recommended live window for stability
DEFAULT_UNKNOWN_STREAK_LIMIT = 2
DEFAULT_HOLD_TTL_S = 4.0

# Enrollment guidance
# Recommended minimum to get a solid initial voice print.
# Adjust here to tune UX globally.
DEFAULT_ENROLL_CLIP_DURATION_S = 7  # seconds per clip
DEFAULT_ENROLL_TARGET_CLIPS = 7     # number of clips to collect

# Identification operating points (global defaults)
# Speaker vs Background thresholds and margins
DEFAULT_SPK_THRESHOLD = 0.38      # slightly stricter but still permissive
DEFAULT_BG_THRESHOLD = 0.70       # reduce spurious background wins
DEFAULT_DECISION_MARGIN = 0.07    # keep margin as before
DEFAULT_BG_MARGIN_OVER_SPK = 0.10 # background must beat speaker more clearly
DEFAULT_RMS_SPEECH_GATE = 1e-3    # minimum RMS to consider a window as speech

# UI/behavior toggles
DEFAULT_CONFIDENCE_SMOOTHING = 0.80  # emphasize new values to show peaks
DEFAULT_SESSION_LOGGING = False      # Log live identify sessions (UI+API logs)

# Experimental/live detection helpers
DEFAULT_EMBED_AVG = True            # average last N window embeddings
DEFAULT_EMBED_AVG_N = 3             # number of windows to average
DEFAULT_VAD_TRIM = True             # trim non-speech inside live window before scoring
