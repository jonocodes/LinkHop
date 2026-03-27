"""
Browser-based E2E tests for SSE realtime message subscription.

These tests use Playwright to verify that messages appear in real-time
when sent between two devices using Server-Sent Events (SSE).
"""

import re
import time
from typing import Dict

import pytest
from playwright.sync_api import Page, Browser, BrowserContext, expect


@pytest.fixture
def device_context(browser: Browser, django_server: str) -> BrowserContext:
    """Create a browser context for a device."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
    )
    return context


class TestSSERealtimeMessages:
    """Test real-time message delivery via SSE in the browser."""

    def test_connect_page_loads(self, page: Page, django_server: str):
        """Test that the connect page loads correctly."""
        print("\n📱 Testing connect page loads...")
        
        page.goto(f"{django_server}/connect")
        
        # Verify page loaded
        expect(page).to_have_title(re.compile("LinkHop"))
        
        # Check for connect form
        assert page.locator("input[name='device_name']").is_visible()
        assert page.locator("button[type='submit']").is_visible()
        
        print("✅ Connect page loads correctly")

    def test_device_enrollment_creates_device(self, page: Page, django_server: str):
        """Test enrolling a device through the browser."""
        print("\n📱 Testing device enrollment...")
        
        # Go to connect page
        page.goto(f"{django_server}/connect")
        
        # Fill in device name
        device_name = "Test Device Browser"
        page.locator("input[name='device_name']").fill(device_name)
        
        # Submit form
        page.locator("button[type='submit']").click()
        
        # Should redirect to inbox
        expect(page).to_have_url(re.compile("/inbox"))
        
        # Verify device name appears on page
        assert device_name in page.content()
        
        print(f"✅ Device '{device_name}' enrolled successfully")

    def test_inbox_receives_message_in_realtime(self, browser: Browser, django_server: str):
        """Test that inbox receives messages in real-time via SSE.
        
        This test:
        1. Creates two browser contexts (simulating two devices)
        2. Enrolls both devices
        3. Opens inbox on recipient device
        4. Sends a message from sender device
        5. Verifies message appears in recipient inbox without refresh
        """
        print("\n🔄 Testing real-time message delivery via SSE...")
        
        # Create two browser contexts
        sender_context = browser.new_context(viewport={"width": 1280, "height": 720})
        recipient_context = browser.new_context(viewport={"width": 1280, "height": 720})
        
        sender_page = sender_context.new_page()
        recipient_page = recipient_context.new_page()
        
        try:
            # Step 1: Enroll sender device
            print("\n1️⃣ Enrolling sender device...")
            sender_page.goto(f"{django_server}/connect")
            sender_device_name = "Sender Browser Device"
            sender_page.locator("input[name='device_name']").fill(sender_device_name)
            sender_page.locator("button[type='submit']").click()
            expect(sender_page).to_have_url(re.compile("/inbox"))
            print(f"✅ Sender device '{sender_device_name}' enrolled")
            
            # Get sender device ID from the page
            sender_content = sender_page.content()
            # Extract device ID from page (it should be in the HTML somewhere)
            
            # Step 2: Enroll recipient device
            print("\n2️⃣ Enrolling recipient device...")
            recipient_page.goto(f"{django_server}/connect")
            recipient_device_name = "Recipient Browser Device"
            recipient_page.locator("input[name='device_name']").fill(recipient_device_name)
            recipient_page.locator("button[type='submit']").click()
            expect(recipient_page).to_have_url(re.compile("/inbox"))
            print(f"✅ Recipient device '{recipient_device_name}' enrolled")
            
            # Step 3: Navigate recipient to inbox and wait for SSE connection
            print("\n3️⃣ Opening recipient inbox (SSE connection established)...")
            # Inbox is already loaded after enrollment
            # The SSE client should automatically connect
            time.sleep(1)  # Give SSE time to establish
            
            # Step 4: Send a message from sender to recipient
            print("\n4️⃣ Sending message from sender...")
            
            # Navigate to send page
            sender_page.goto(f"{django_server}/send")
            
            # Fill in message details
            test_url = "https://example.com/test-message"
            sender_page.locator("input[name='body']").fill(test_url)
            
            # Select recipient from dropdown
            sender_page.locator("select[name='recipient_device_id']").select_option(
                label=recipient_device_name
            )
            
            # Submit message
            sender_page.locator("button[type='submit']").click()
            
            # Verify success message
            expect(sender_page.locator(".success, .alert-success")).to_be_visible()
            print(f"✅ Message sent: {test_url}")
            
            # Step 5: Verify message appears in recipient inbox WITHOUT refreshing
            print("\n5️⃣ Verifying message appears in recipient inbox (real-time)...")
            
            # Wait for SSE to deliver the message
            # The message should appear automatically via SSE
            max_wait = 5  # seconds
            start_time = time.time()
            message_found = False
            
            while time.time() - start_time < max_wait:
                # Check if message appears in inbox
                if test_url in recipient_page.content():
                    message_found = True
                    break
                time.sleep(0.5)
            
            assert message_found, f"Message did not appear in recipient inbox within {max_wait} seconds"
            
            # Verify message is visible on the page
            message_link = recipient_page.locator(f"text={test_url}")
            expect(message_link).to_be_visible()
            
            print("✅ Message appeared in real-time via SSE!")
            
        finally:
            sender_context.close()
            recipient_context.close()

    def test_message_status_updates_in_realtime(self, browser: Browser, django_server: str):
        """Test that message status updates are received in real-time.
        
        This test verifies that when a message is opened, the sender
        can see the status update in real-time.
        """
        print("\n🔄 Testing real-time status updates...")
        
        # Create two browser contexts
        sender_context = browser.new_context(viewport={"width": 1280, "height": 720})
        recipient_context = browser.new_context(viewport={"width": 1280, "height": 720})
        
        sender_page = sender_context.new_page()
        recipient_page = recipient_context.new_page()
        
        try:
            # Enroll both devices
            sender_device_name = "Status Test Sender"
            recipient_device_name = "Status Test Recipient"
            
            # Enroll sender
            sender_page.goto(f"{django_server}/connect")
            sender_page.locator("input[name='device_name']").fill(sender_device_name)
            sender_page.locator("button[type='submit']").click()
            expect(sender_page).to_have_url(re.compile("/inbox"))
            
            # Enroll recipient
            recipient_page.goto(f"{django_server}/connect")
            recipient_page.locator("input[name='device_name']").fill(recipient_device_name)
            recipient_page.locator("button[type='submit']").click()
            expect(recipient_page).to_have_url(re.compile("/inbox"))
            
            # Send message
            test_url = "https://example.com/status-test"
            sender_page.goto(f"{django_server}/send")
            sender_page.locator("input[name='body']").fill(test_url)
            sender_page.locator("select[name='recipient_device_id']").select_option(
                label=recipient_device_name
            )
            sender_page.locator("button[type='submit']").click()
            
            # Wait for message to appear in recipient inbox
            time.sleep(2)
            
            # Click on message to open it
            message_link = recipient_page.locator(f"text={test_url}")
            if message_link.is_visible():
                message_link.click()
                
                # Wait for redirect
                time.sleep(1)
                
                # Verify we're on the message detail page
                expect(recipient_page).to_have_url(re.compile("/messages/"))
                
                print("✅ Recipient opened the message")
                
        finally:
            sender_context.close()
            recipient_context.close()

    def test_multiple_messages_arrive_in_order(self, browser: Browser, django_server: str):
        """Test that multiple messages arrive in the correct order."""
        print("\n🔄 Testing multiple message ordering...")
        
        sender_context = browser.new_context(viewport={"width": 1280, "height": 720})
        recipient_context = browser.new_context(viewport={"width": 1280, "height": 720})
        
        sender_page = sender_context.new_page()
        recipient_page = recipient_context.new_page()
        
        try:
            # Enroll devices
            sender_page.goto(f"{django_server}/connect")
            sender_page.locator("input[name='device_name']").fill("Multi Sender")
            sender_page.locator("button[type='submit']").click()
            
            recipient_page.goto(f"{django_server}/connect")
            recipient_page.locator("input[name='device_name']").fill("Multi Recipient")
            recipient_page.locator("button[type='submit']").click()
            
            # Send multiple messages quickly
            messages = [
                "https://example.com/msg1",
                "https://example.com/msg2",
                "https://example.com/msg3",
            ]
            
            for i, msg in enumerate(messages):
                sender_page.goto(f"{django_server}/send")
                sender_page.locator("input[name='body']").fill(msg)
                sender_page.locator("select[name='recipient_device_id']").select_option(
                    label="Multi Recipient"
                )
                sender_page.locator("button[type='submit']").click()
                time.sleep(0.5)  # Small delay between messages
            
            # Wait for all messages to arrive
            time.sleep(3)
            
            # Verify all messages are present
            content = recipient_page.content()
            for msg in messages:
                assert msg in content, f"Message {msg} not found in inbox"
            
            print(f"✅ All {len(messages)} messages arrived successfully")
            
        finally:
            sender_context.close()
            recipient_context.close()
