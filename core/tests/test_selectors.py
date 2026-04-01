from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from core.selectors import device_presence_status, format_time_ago, list_active_devices


class FormatTimeAgoTests(TestCase):
    """Tests for the format_time_ago function."""

    def test_none_returns_never(self):
        self.assertEqual(format_time_ago(None), "Never")

    def test_just_now_for_recent(self):
        now = timezone.now()
        self.assertEqual(format_time_ago(now), "Just now")
        dt = now - timedelta(seconds=30)
        self.assertEqual(format_time_ago(dt), "Just now")

    def test_minutes_ago(self):
        now = timezone.now()
        dt = now - timedelta(minutes=1)
        self.assertEqual(format_time_ago(dt), "1 minute ago")
        dt = now - timedelta(minutes=5)
        self.assertEqual(format_time_ago(dt), "5 minutes ago")

    def test_hours_ago(self):
        now = timezone.now()
        dt = now - timedelta(hours=1)
        self.assertEqual(format_time_ago(dt), "1 hour ago")
        dt = now - timedelta(hours=3)
        self.assertEqual(format_time_ago(dt), "3 hours ago")

    def test_days_ago(self):
        now = timezone.now()
        dt = now - timedelta(days=1)
        self.assertEqual(format_time_ago(dt), "1 day ago")
        dt = now - timedelta(days=3)
        self.assertEqual(format_time_ago(dt), "3 days ago")

    def test_weeks_ago(self):
        now = timezone.now()
        dt = now - timedelta(days=7)
        self.assertEqual(format_time_ago(dt), "1 week ago")
        dt = now - timedelta(days=14)
        self.assertEqual(format_time_ago(dt), "2 weeks ago")

    def test_months_ago(self):
        now = timezone.now()
        dt = now - timedelta(days=30)
        self.assertEqual(format_time_ago(dt), "1 month ago")
        dt = now - timedelta(days=90)
        self.assertEqual(format_time_ago(dt), "3 months ago")

    def test_years_ago(self):
        now = timezone.now()
        dt = now - timedelta(days=365)
        self.assertEqual(format_time_ago(dt), "1 year ago")
        dt = now - timedelta(days=730)
        self.assertEqual(format_time_ago(dt), "2 years ago")


class ListActiveDevicesTests(TestCase):

    def test_returns_only_active_devices(self):
        from core.models import Device

        active = Device.objects.create(name="Active Device", token_hash="active123")
        Device.objects.create(name="Inactive Device", token_hash="inactive123", is_active=False)
        Device.objects.create(name="Revoked Device", token_hash="revoked123", revoked_at=timezone.now())

        devices = list_active_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].name, "Active Device")

    def test_orders_by_name(self):
        from core.models import Device

        Device.objects.create(name="Zebra", token_hash="z123")
        Device.objects.create(name="Apple", token_hash="a123")
        Device.objects.create(name="Banana", token_hash="b123")

        devices = list_active_devices()
        names = [d.name for d in devices]
        self.assertEqual(names, ["Apple", "Banana", "Zebra"])


class DevicePresenceStatusTests(TestCase):

    def test_recent_device(self):
        from core.models import Device
        device = Device.objects.create(
            name="Recent Device",
            token_hash="recent123",
            last_seen_at=timezone.now(),
        )
        self.assertEqual(device_presence_status(device), "recent")

    def test_offline_device(self):
        from core.models import Device
        device = Device.objects.create(
            name="Offline Device",
            token_hash="offline123",
            last_seen_at=timezone.now() - timedelta(minutes=10),
        )
        self.assertEqual(device_presence_status(device), "offline")

    def test_never_seen_device(self):
        from core.models import Device
        device = Device.objects.create(
            name="Never Seen",
            token_hash="never123",
        )
        self.assertEqual(device_presence_status(device), "offline")
