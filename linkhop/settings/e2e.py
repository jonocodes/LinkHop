"""
Settings for E2E tests with isolated database.
"""
from .base import *  # noqa: F403
import os

DEBUG = False
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

AXES_ENABLED = False

# Use a separate database file for E2E tests
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "data" / "e2e-test.sqlite3",  # noqa: F405
    }
}
