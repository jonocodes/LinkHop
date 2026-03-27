from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from core.selectors import format_time_ago, is_device_online, list_active_devices


class FormatTimeAgoTests(TestCase):
    """Tests for the format_time_ago function."""

    def test_none_returns_never(self):
        """Test that None returns 'Never'."""
        self.assertEqual(format_time_ago(None), "Never")

    def test_just_now_for_recent(self):
        """Test that times less than 1 minute ago show 'Just now'."""
        now = timezone.now()
        self.assertEqual(format_time_ago(now), "Just now")
        
        # 30 seconds ago
        dt = now - timedelta(seconds=30)
        self.assertEqual(format_time_ago(dt), "Just now")

    def test_minutes_ago(self):
        """Test formatting minutes ago."""
        now = timezone.now()
        
        # 1 minute ago
        dt = now - timedelta(minutes=1)
        self.assertEqual(format_time_ago(dt), "1 minute ago")
        
        # 5 minutes ago
        dt = now - timedelta(minutes=5)
        self.assertEqual(format_time_ago(dt), "5 minutes ago")

    def test_hours_ago(self):
        """Test formatting hours ago."""
        now = timezone.now()
        
        # 1 hour ago
        dt = now - timedelta(hours=1)
        self.assertEqual(format_time_ago(dt), "1 hour ago")
        
        # 3 hours ago
        dt = now - timedelta(hours=3)
        self.assertEqual(format_time_ago(dt), "3 hours ago")

    def test_days_ago(self):
        """Test formatting days ago."""
        now = timezone.now()
        
        # 1 day ago
        dt = now - timedelta(days=1)
        self.assertEqual(format_time_ago(dt), "1 day ago")
        
        # 3 days ago
        dt = now - timedelta(days=3)
        self.assertEqual(format_time_ago(dt), "3 days ago")

    def test_weeks_ago(self):
        """Test formatting weeks ago."""
        now = timezone.now()
        
        # 1 week ago
        dt = now - timedelta(days=7)
        self.assertEqual(format_time_ago(dt), "1 week ago")
        
        # 2 weeks ago
        dt = now - timedelta(days=14)
        self.assertEqual(format_time_ago(dt), "2 weeks ago")

    def test_months_ago(self):
        """Test formatting months ago."""
        now = timezone.now()
        
        # 1 month ago (approx)
        dt = now - timedelta(days=30)
        self.assertEqual(format_time_ago(dt), "1 month ago")
        
        # 3 months ago (approx)
        dt = now - timedelta(days=90)
        self.assertEqual(format_time_ago(dt), "3 months ago")

    def test_years_ago(self):
        """Test formatting years ago."""
        now = timezone.now()
        
        # 1 year ago (approx)
        dt = now - timedelta(days=365)
        self.assertEqual(format_time_ago(dt), "1 year ago")
        
        # 2 years ago (approx)
        dt = now - timedelta(days=730)
        self.assertEqual(format_time_ago(dt), "2 years ago")


class ListActiveDevicesTests(TestCase):
    """Tests for the list_active_devices function."""

    def test_returns_only_active_devices(self):
        """Test that only active, non-revoked devices are returned."""
        from core.models import Device
        
        # Create active device
        active = Device.objects.create(name="Active Device", token_hash="active123")
        
        # Create inactive device
        Device.objects.create(name="Inactive Device", token_hash="inactive123", is_active=False)
        
        # Create revoked device
        Device.objects.create(name="Revoked Device", token_hash="revoked123", revoked_at=timezone.now())
        
        devices = list_active_devices()
        
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].name, "Active Device")

    def test_orders_by_name(self):
        """Test that devices are ordered by name."""
        from core.models import Device
        
        Device.objects.create(name="Zebra", token_hash="z123")
        Device.objects.create(name="Apple", token_hash="a123")
        Device.objects.create(name="Banana", token_hash="b123")
        
        devices = list_active_devices()
        
        names = [d.name for d in devices]
        self.assertEqual(names, ["Apple", "Banana", "Zebra"])


class IsDeviceOnlineTests(TestCase):
    """Tests for the is_device_online function."""

    def test_returns_true_when_stream_active(self):
        """Test that device is online when it has active SSE streams."""
        from core.models import Device
        
        device = Device.objects.create(name="Online Device", token_hash="online123")
        
        # Mock active_stream_count to return 1 (has active stream)
        with patch("core.sse.active_stream_count", return_value=1):
            self.assertTrue(is_device_online(device))

    def test_returns_false_when_no_stream(self):
        """Test that device is offline when no SSE streams."""
        from core.models import Device
        
        device = Device.objects.create(name="Offline Device", token_hash="offline123")
        
        # Mock active_stream_count to return 0 (no active stream)
        with patch("core.sse.active_stream_count", return_value=0):
            self.assertFalse(is_device_online(device))

    def test_returns_false_when_multiple_streams(self):
        """Test that device is online with multiple active streams."""
        from core.models import Device
        
        device = Device.objects.create(name="Multi Stream", token_hash="multi123")
        
        # Mock active_stream_count to return 2 (multiple active streams)
        with patch("core.sse.active_stream_count", return_value=2):
            self.assertTrue(is_device_online(device))
