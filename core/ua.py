"""
User-agent parsing helpers.
Produces short human-readable strings for browser and OS fields on Device.
"""


def parse_ua(ua_string: str) -> tuple[str, str]:
    """
    Return (browser, os) strings parsed from a User-Agent header.
    Falls back gracefully if user-agents is unavailable or the string is empty.
    Examples: ("Chrome 122", "Android 14"), ("Firefox 124", "Windows 11")
    """
    if not ua_string:
        return "", ""

    try:
        import user_agents
        ua = user_agents.parse(ua_string)

        browser_family = ua.browser.family or ""
        browser_ver = (ua.browser.version or (0,))[0]  # major version only
        browser = f"{browser_family} {browser_ver}".strip() if browser_family else ""

        os_family = ua.os.family or ""
        os_ver = (ua.os.version or (0,))[0]
        os_str = f"{os_family} {os_ver}".strip() if os_family else ""

        # Trim useless "Other" family
        if browser_family == "Other":
            browser = ""
        if os_family == "Other":
            os_str = ""

        return browser, os_str

    except Exception:
        return "", ""
