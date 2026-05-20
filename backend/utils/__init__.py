from __future__ import annotations

from utils.ticket_no import (
    _YW_TICKET_NO_RE,
    _HPM_TICKET_NO_RE,
    _YW_ADVISORY_LOCK_KEY1,
    _YW_ADVISORY_LOCK_KEY2,
    _CHINA_TZ,
    allocate_yw_ticket_no,
    allocate_hpm_ticket_no,
)
from utils.person_display import (
    dedupe_preserve_str,
    canonical_person_display,
    canonical_multi_person_display,
)
from utils.validators import (
    field_visible,
    matches_required_if,
    optional_when_all_matches,
    optional_when_any_matches,
    effective_required,
    validate_one,
)
from utils.date_helpers import (
    duty_month_bounds,
    parse_last_accept_at,
    parse_iso_dt,
    parse_ymd,
    to_utc_start,
)