# LinkHop CLI Specification

## Version 1.0.0 - Draft

This document defines the specification for a command-line interface (CLI) for LinkHop, enabling power users to send and receive messages from the terminal.

---

## 1. Python Packaging and Distribution

### 1.1 Package Structure

```
linkhop-cli/
├── pyproject.toml
├── README.md
├── src/
│   └── linkhop_cli/
│       ├── __init__.py
│       ├── __main__.py
│       ├── cli.py              # Main CLI entry point
│       ├── api.py              # API client
│       ├── auth.py             # Authentication handling
│       ├── config.py           # Configuration management
│       ├── device_picker.py    # Interactive device selection
│       ├── inbox.py            # Inbox display
│       └── utils.py            # Utilities
├── tests/
│   ├── test_cli.py
│   ├── test_api.py
│   └── test_auth.py
└── docs/
    └── CLI.md
```

### 1.2 Installation Methods

**PyPI (Primary):**
```bash
pip install linkhop-cli
```

**Homebrew (macOS/Linux):**
```bash
brew install linkhop/tap/linkhop
```

**AUR (Arch Linux):**
```bash
yay -S linkhop-cli
```

**Snap:**
```bash
snap install linkhop-cli
```

**Direct from GitHub:**
```bash
pip install git+https://github.com/yourusername/linkhop-cli.git
```

### 1.3 pyproject.toml Configuration

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "linkhop-cli"
version = "1.0.0"
description = "Command-line interface for LinkHop"
readme = "README.md"
license = "MIT"
requires-python = ">=3.9"
authors = [
    { name = "Your Name", email = "you@example.com" }
]
keywords = ["linkhop", "cli", "messaging", "productivity"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Environment :: Console",
    "Intended Audience :: End Users/Desktop",
    "License :: OSI Approved :: MIT License",
    "Operating System :: OS Independent",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
    "Topic :: Communications",
    "Topic :: Utilities",
]

dependencies = [
    "click>=8.0",
    "requests>=2.28",
    "rich>=13.0",           # Terminal formatting
    "inquirer>=3.0",        # Interactive prompts
    "pydantic>=2.0",        # Data validation
    "keyring>=24.0",        # Secure credential storage
    "platformdirs>=3.0",    # Cross-platform config directories
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-cov>=4.0",
    "black>=23.0",
    "ruff>=0.1",
    "mypy>=1.0",
    "types-requests",
]

[project.scripts]
lh = "linkhop_cli.cli:main"
linkhop = "linkhop_cli.cli:main"

[project.urls]
Homepage = "https://github.com/yourusername/linkhop-cli"
Documentation = "https://github.com/yourusername/linkhop-cli#readme"
Repository = "https://github.com/yourusername/linkhop-cli"
Issues = "https://github.com/yourusername/linkhop-cli/issues"

[tool.black]
line-length = 100
target-version = ['py39']

[tool.ruff]
line-length = 100
select = ["E", "F", "I", "UP", "B", "C4", "SIM"]

[tool.mypy]
python_version = "3.9"
strict = true
```

---

## 2. Shared Code Reuse with Django App

### 2.1 Shared Components

**API Client:**
```python
# linkhop_cli/api.py
import requests
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, HttpUrl

class LinkHopAPI:
    """API client for LinkHop server."""
    
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'LinkHop-CLI/1.0.0'
        })
    
    def send_message(self, recipient_id: str, msg_type: str, body: str) -> Dict[str, Any]:
        """Send a message."""
        response = self.session.post(
            f"{self.base_url}/api/messages",
            json={
                'recipient_device_id': recipient_id,
                'type': msg_type,
                'body': body
            }
        )
        response.raise_for_status()
        return response.json()
    
    def get_devices(self) -> List[Dict[str, Any]]:
        """List available devices."""
        response = self.session.get(f"{self.base_url}/api/devices")
        response.raise_for_status()
        return response.json()
    
    def get_inbox(self) -> List[Dict[str, Any]]:
        """Get incoming messages."""
        response = self.session.get(f"{self.base_url}/api/messages/incoming")
        response.raise_for_status()
        return response.json()
    
    def mark_opened(self, message_id: str) -> None:
        """Mark message as opened."""
        self.session.post(f"{self.base_url}/api/messages/{message_id}/opened")
```

**Configuration Schema:**
```python
# linkhop_cli/config.py
from pydantic import BaseModel, Field, HttpUrl
from pathlib import Path
import json
from platformdirs import user_config_dir

class Config(BaseModel):
    """CLI configuration."""
    
    server_url: str = Field(default="https://linkhop.example.com")
    device_token: Optional[str] = None
    default_recipient: Optional[str] = None
    recent_devices: List[str] = Field(default_factory=list)
    
    @classmethod
    def load(cls) -> "Config":
        """Load configuration from file."""
        config_dir = Path(user_config_dir("linkhop", "LinkHop"))
        config_file = config_dir / "config.json"
        
        if config_file.exists():
            with open(config_file) as f:
                return cls(**json.load(f))
        return cls()
    
    def save(self) -> None:
        """Save configuration to file."""
        config_dir = Path(user_config_dir("linkhop", "LinkHop"))
        config_dir.mkdir(parents=True, exist_ok=True)
        
        config_file = config_dir / "config.json"
        with open(config_file, 'w') as f:
            json.dump(self.model_dump(), f, indent=2)
```

### 2.2 Reuse Strategy

**What to Share:**
- API client logic (consistent with web app JavaScript)
- Data models (Pydantic schemas matching Django Ninja)
- Validation logic (URL validation, etc.)

**What NOT to Share:**
- Django models (CLI uses API, not direct DB access)
- Server settings
- Admin functionality

**Version Compatibility:**
- CLI specifies minimum server version
- API versioning in URL path
- Graceful degradation for older servers

---

## 3. Interactive Prompt Flow

### 3.1 Main CLI Entry Point

```python
# linkhop_cli/cli.py
import click
from rich.console import Console
from rich.table import Table
from .api import LinkHopAPI
from .auth import ensure_auth
from .device_picker import pick_device
from .inbox import display_inbox

console = Console()

@click.group()
@click.option('--server', '-s', help='LinkHop server URL')
@click.option('--token', '-t', help='Device token (or set LINKHOP_TOKEN env)')
@click.pass_context
def cli(ctx, server, token):
    """LinkHop CLI - Send links and text between devices."""
    ctx.ensure_object(dict)
    
    # Load config
    config = Config.load()
    
    # Override with CLI options
    if server:
        config.server_url = server
    if token:
        config.device_token = token
    
    # Ensure we have a token
    if not config.device_token:
        config.device_token = ensure_auth(config.server_url)
    
    # Create API client
    ctx.obj['api'] = LinkHopAPI(config.server_url, config.device_token)
    ctx.obj['config'] = config

# Import subcommands
from .commands import send, inbox, devices, auth

cli.add_command(send)
cli.add_command(inbox)
cli.add_command(devices)
cli.add_command(auth)

def main():
    cli()

if __name__ == '__main__':
    main()
```

### 3.2 Authentication Flow

```python
# linkhop_cli/auth.py
import click
from rich.console import Console
from rich.panel import Panel

console = Console()

def ensure_auth(server_url: str) -> str:
    """Ensure user is authenticated."""
    
    console.print(Panel.fit(
        "Welcome to LinkHop CLI!\n\n"
        "To use the CLI, you need to link it to your device.\n"
        f"1. Go to {server_url}/connect in your browser\n"
        "2. Copy your device token\n"
        "3. Paste it below",
        title="LinkHop CLI Setup",
        border_style="blue"
    ))
    
    token = click.prompt("Device token", hide_input=True)
    
    # Validate token
    try:
        api = LinkHopAPI(server_url, token)
        device = api.get_device_info()
        console.print(f"✓ Authenticated as {device['name']}", style="green")
        
        # Store token securely
        from keyring import set_password
        set_password("linkhop", "device_token", token)
        
        return token
    except Exception as e:
        console.print(f"✗ Authentication failed: {e}", style="red")
        raise click.Abort()
```

### 3.3 Send Command Flow

```python
# linkhop_cli/commands/send.py
import click
from rich.console import Console
from rich.panel import Panel
import inquirer

console = Console()

@click.command()
@click.argument('content', required=False)
@click.option('--to', '-t', help='Recipient device name or ID')
@click.option('--type', 'msg_type', type=click.Choice(['url', 'text']), help='Message type')
@click.option('--yes', '-y', is_flag=True, help='Skip confirmation')
@click.pass_context
def send(ctx, content, to, msg_type, yes):
    """Send a URL or text message."""
    
    api = ctx.obj['api']
    config = ctx.obj['config']
    
    # Get content if not provided
    if not content:
        # Try clipboard
        try:
            import pyperclip
            clipboard = pyperclip.paste()
            if clipboard:
                use_clipboard = click.confirm(f"Use clipboard content?\n{clipboard[:100]}...")
                if use_clipboard:
                    content = clipboard
        except ImportError:
            pass
        
        if not content:
            content = click.prompt("Message content")
    
    # Auto-detect type
    if not msg_type:
        msg_type = 'url' if is_valid_url(content) else 'text'
    
    # Get recipient
    if not to:
        # Show device picker
        devices = api.get_devices()
        to = pick_device(devices, config.default_recipient)
    
    # Get recipient ID from name
    recipient_id = resolve_recipient(api, to)
    
    # Preview
    if not yes:
        console.print(Panel.fit(
            f"Type: {msg_type}\n"
            f"To: {to}\n"
            f"Content: {content[:200]}{'...' if len(content) > 200 else ''}",
            title="Send Preview",
            border_style="blue"
        ))
        
        if not click.confirm("Send?"):
            console.print("Cancelled.")
            return
    
    # Send
    try:
        result = api.send_message(recipient_id, msg_type, content)
        console.print(f"✓ Sent to {to}", style="green")
        console.print(f"  ID: {result['id']}")
    except Exception as e:
        console.print(f"✗ Failed to send: {e}", style="red")
        raise click.Abort()
```

---

## 4. Searchable Device Picker

### 4.1 Fuzzy Device Selection

```python
# linkhop_cli/device_picker.py
import inquirer
from typing import List, Dict, Optional
from rich.console import Console
from rich.table import Table

console = Console()

def pick_device(devices: List[Dict], default: Optional[str] = None) -> str:
    """Interactive device picker with search."""
    
    if not devices:
        console.print("No devices available.", style="red")
        raise click.Abort()
    
    # Sort: online first, then by name
    devices = sorted(devices, key=lambda d: (not d.get('is_online', False), d['name']))
    
    # Show recent device at top
    choices = []
    for device in devices:
        status = "🟢" if device.get('is_online') else "⚫"
        last_seen = format_last_seen(device.get('last_seen_at'))
        name = f"{status} {device['name']}"
        if device.get('is_online'):
            name += " (online)"
        else:
            name += f" ({last_seen})"
        
        choices.append((name, device['id']))
    
    # Use inquirer for selection
    questions = [
        inquirer.List(
            'device',
            message="Select recipient device",
            choices=choices,
            default=default
        )
    ]
    
    answers = inquirer.prompt(questions)
    return answers['device']

def pick_device_fuzzy(devices: List[Dict], query: str) -> str:
    """Fuzzy search device by name."""
    from fuzzywuzzy import fuzz
    
    matches = []
    for device in devices:
        score = fuzz.partial_ratio(query.lower(), device['name'].lower())
        matches.append((score, device))
    
    matches.sort(reverse=True)
    
    if matches[0][0] > 80:
        return matches[0][1]['id']
    elif len(matches) > 1 and matches[0][0] == matches[1][0]:
        # Ambiguous, show picker
        console.print(f"Multiple matches for '{query}':")
        return pick_device([m[1] for m in matches[:5]], None)
    else:
        console.print(f"No device matching '{query}'")
        return pick_device(devices, None)

def display_devices(devices: List[Dict]) -> None:
    """Display devices in a table."""
    table = Table(title="Available Devices")
    table.add_column("Name", style="cyan")
    table.add_column("Status")
    table.add_column("Last Seen")
    
    for device in devices:
        status = "🟢 Online" if device.get('is_online') else "⚫ Offline"
        last_seen = format_last_seen(device.get('last_seen_at'))
        table.add_row(device['name'], status, last_seen)
    
    console.print(table)
```

### 4.2 Recent Device Shortcut

```python
# Store and use recent devices
RECENT_DEVICES_MAX = 5

def update_recent_devices(config: Config, device_id: str) -> None:
    """Update recent devices list."""
    # Move to front if exists
    if device_id in config.recent_devices:
        config.recent_devices.remove(device_id)
    
    config.recent_devices.insert(0, device_id)
    config.recent_devices = config.recent_devices[:RECENT_DEVICES_MAX]
    config.save()

def get_device_choices(devices: List[Dict], recent_ids: List[str]) -> List:
    """Get device choices with recent at top."""
    choices = []
    
    # Recent devices first
    for recent_id in recent_ids:
        device = next((d for d in devices if d['id'] == recent_id), None)
        if device:
            name = f"⭐ {device['name']} (recent)"
            choices.append((name, device['id']))
    
    # Separator
    if choices:
        choices.append(("─" * 40, None))
    
    # All devices
    for device in devices:
        if device['id'] not in recent_ids:
            status = "🟢" if device.get('is_online') else "⚫"
            name = f"{status} {device['name']}"
            choices.append((name, device['id']))
    
    return choices
```

---

## 5. Non-Interactive/Scripted Usage

### 5.1 Full Non-Interactive Mode

```python
# Example: lh send "https://example.com" --to laptop --type url --yes

@click.command()
@click.argument('content')
@click.option('--to', '-t', required=True, help='Recipient device name/ID')
@click.option('--type', 'msg_type', required=True, type=click.Choice(['url', 'text']))
@click.option('--yes', '-y', is_flag=True, help='Skip confirmation')
@click.pass_context
def send(ctx, content, to, msg_type, yes):
    """Send a message (non-interactive)."""
    api = ctx.obj['api']
    
    # Resolve recipient
    devices = api.get_devices()
    recipient = None
    
    for device in devices:
        if device['id'] == to or device['name'].lower() == to.lower():
            recipient = device
            break
    
    if not recipient:
        console.print(f"Device '{to}' not found", style="red")
        # In non-interactive mode, list available devices
        if not yes:
            console.print("\nAvailable devices:")
            for d in devices:
                console.print(f"  - {d['name']} ({d['id']})")
        raise click.Abort()
    
    # Send
    result = api.send_message(recipient['id'], msg_type, content)
    
    # JSON output for scripting
    if ctx.obj.get('json_output'):
        import json
        click.echo(json.dumps(result))
    else:
        console.print(f"Sent: {result['id']}")
```

### 5.2 JSON Output Mode

```python
@click.option('--json', 'json_output', is_flag=True, help='Output as JSON')
@click.pass_context
def cli(ctx, server, token, json_output):
    ctx.obj['json_output'] = json_output

# In commands:
if ctx.obj.get('json_output'):
    import json
    click.echo(json.dumps(data))
else:
    # Pretty print
    display_table(data)
```

### 5.3 Common Scripting Patterns

**Send from shell script:**
```bash
#!/bin/bash
# Send current URL from browser
URL=$(osascript -e 'tell application "Chrome" to get URL of active tab of front window')
lh send "$URL" --to laptop --type url --yes

# Or using xdg-open on Linux
# xdg-open "https://linkhop.example.com/send?type=url&body=$URL&recipient=laptop-id"
```

**Send clipboard content:**
```bash
# macOS
pbpaste | lh send --to phone --type text --yes

# Linux
xclip -o | lh send --to phone --type text --yes
```

**Check inbox:**
```bash
# Get unread count
COUNT=$(lh inbox --json | jq '. | length')
echo "You have $COUNT unread messages"
```

---

## 6. Authentication Flow for CLI

### 6.1 Token Storage Strategy

**Secure Storage:**
```python
# linkhop_cli/auth.py
import keyring
from pathlib import Path

def store_token(token: str) -> None:
    """Store token securely."""
    keyring.set_password("linkhop", "device_token", token)

def get_token() -> Optional[str]:
    """Retrieve token from secure storage."""
    return keyring.get_password("linkhop", "device_token")

def delete_token() -> None:
    """Delete stored token."""
    try:
        keyring.delete_password("linkhop", "device_token")
    except keyring.errors.PasswordDeleteError:
        pass
```

**Environment Variable Override:**
```python
def get_token() -> Optional[str]:
    """Get token from env or keyring."""
    # Environment takes precedence
    if 'LINKHOP_TOKEN' in os.environ:
        return os.environ['LINKHOP_TOKEN']
    
    # Then check keyring
    return keyring.get_password("linkhop", "device_token")
```

### 6.2 Authentication Commands

```python
@click.group()
def auth():
    """Authentication commands."""
    pass

@auth.command()
@click.option('--token', '-t', prompt=True, hide_input=True)
@click.option('--server', '-s', default="https://linkhop.example.com")
def login(token, server):
    """Authenticate with device token."""
    try:
        api = LinkHopAPI(server, token)
        device = api.get_device_info()
        
        # Store credentials
        store_token(token)
        config = Config.load()
        config.server_url = server
        config.device_token = token
        config.save()
        
        console.print(f"✓ Logged in as {device['name']}", style="green")
    except Exception as e:
        console.print(f"✗ Login failed: {e}", style="red")

@auth.command()
def logout():
    """Log out and remove credentials."""
    delete_token()
    config = Config.load()
    config.device_token = None
    config.save()
    console.print("✓ Logged out", style="green")

@auth.command()
def status():
    """Show authentication status."""
    token = get_token()
    if token:
        try:
            config = Config.load()
            api = LinkHopAPI(config.server_url, token)
            device = api.get_device_info()
            console.print(f"Logged in: {device['name']}")
            console.print(f"Server: {config.server_url}")
        except Exception as e:
            console.print(f"Token invalid: {e}", style="red")
    else:
        console.print("Not logged in", style="yellow")
```

### 6.3 Device Linking Options

**Option 1: Copy Token from Web App (Recommended)**
```
1. User runs `lh login`
2. CLI prompts for token
3. User copies token from web app /connect page
4. CLI validates and stores token
```

**Option 2: QR Code (Future)**
```
1. User runs `lh login --qr`
2. CLI shows QR code scanner or opens camera
3. User scans QR from web app
4. Token extracted and validated
```

---

## 7. Send and Inbox Command Set

### 7.1 Send Command

```bash
# Interactive
$ lh send
? Message content: https://example.com
? Select recipient: ⭐ Laptop (recent)
✓ Sent to Laptop

# Non-interactive
$ lh send "https://example.com" --to laptop --type url --yes
✓ Sent to Laptop

# From clipboard (auto-detect)
$ lh send --to phone
? Use clipboard content? https://example.com/article...
? (Y/n): y
✓ Sent to Phone

# Text message
$ lh send "Meet me at 3pm" --to laptop --type text
✓ Sent to Laptop

# Send to multiple devices
$ lh send "https://example.com" --to laptop --to phone --yes
✓ Sent to 2 devices
```

### 7.2 Inbox Command

```bash
# Show inbox
$ lh inbox
┌─────────────────────────────────────────┐
│ Inbox                                   │
├─────────────────────────────────────────┤
│ 🔗 URL from Laptop          2m ago     │
│ https://example.com/article            │
│                                         │
│ 💬 Text from Phone         15m ago     │
│ "Check this out when you..."           │
└─────────────────────────────────────────┘

# Show last 5 messages
$ lh inbox --limit 5

# JSON output for scripting
$ lh inbox --json
[{"id": "...", "type": "url", "body": "...", ...}]

# Filter by type
$ lh inbox --type url

# Auto-mark as opened when viewed
$ lh inbox --open

# Show unread count only
$ lh inbox --count
3 unread messages
```

### 7.3 Devices Command

```bash
# List devices
$ lh devices
┌─────────────────────────────────────────┐
│ Available Devices                       │
├─────────────────────────────────────────┤
│ 🟢 Laptop                    Online     │
│ ⚫ Phone                     5m ago     │
│ ⚫ iPad                     2h ago     │
└─────────────────────────────────────────┘

# Set default recipient
$ lh devices default laptop
✓ Default device set to: Laptop

# Search devices
$ lh devices search lap
🟢 Laptop (online)

# Refresh device list
$ lh devices refresh
✓ Found 3 devices
```

### 7.4 Additional Commands

```bash
# Quick send to default device
$ lh quick "https://example.com"
✓ Sent to Laptop (default)

# Open message
$ lh open <message-id>
Opening https://example.com...

# Copy message to clipboard
$ lh copy <message-id>
✓ Copied to clipboard

# Mark as opened
$ lh mark <message-id> --opened

# Delete message
$ lh delete <message-id>
? Are you sure? [y/N]: y
✓ Deleted

# Configuration
$ lh config
? Server URL: https://linkhop.example.com
? Default recipient: Laptop
✓ Configuration saved

# Show help
$ lh --help
$ lh send --help
```

---

## 8. CLI Testing Strategy

### 8.1 Test Structure

```python
# tests/test_cli.py
import pytest
from click.testing import CliRunner
from linkhop_cli.cli import cli

class TestSendCommand:
    """Test send command."""
    
    def test_send_interactive(self, mock_api):
        """Test interactive send flow."""
        runner = CliRunner()
        result = runner.invoke(cli, ['send'], input='https://example.com\n1\ny\n')
        assert result.exit_code == 0
        assert 'Sent to' in result.output
    
    def test_send_non_interactive(self, mock_api):
        """Test non-interactive send."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'send', 'https://example.com',
            '--to', 'laptop',
            '--type', 'url',
            '--yes'
        ])
        assert result.exit_code == 0
        assert 'Sent' in result.output
    
    def test_send_device_not_found(self, mock_api):
        """Test error when device not found."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            'send', 'test',
            '--to', 'nonexistent',
            '--type', 'text'
        ])
        assert result.exit_code != 0
        assert 'not found' in result.output

class TestInboxCommand:
    """Test inbox command."""
    
    def test_inbox_display(self, mock_api):
        """Test inbox display."""
        runner = CliRunner()
        result = runner.invoke(cli, ['inbox'])
        assert result.exit_code == 0
        assert 'Inbox' in result.output
    
    def test_inbox_json_output(self, mock_api):
        """Test JSON output."""
        runner = CliRunner()
        result = runner.invoke(cli, ['inbox', '--json'])
        assert result.exit_code == 0
        # Validate JSON
        import json
        data = json.loads(result.output)
        assert isinstance(data, list)

class TestAuthCommand:
    """Test authentication commands."""
    
    def test_login_success(self, mock_api):
        """Test successful login."""
        runner = CliRunner()
        result = runner.invoke(cli, ['auth', 'login', '--token', 'valid_token'])
        assert result.exit_code == 0
        assert 'Logged in' in result.output
    
    def test_logout(self, mock_api):
        """Test logout."""
        runner = CliRunner()
        result = runner.invoke(cli, ['auth', 'logout'])
        assert result.exit_code == 0
        assert 'Logged out' in result.output
```

### 8.2 Integration Tests

```python
# tests/test_integration.py
import pytest
import responses

@pytest.fixture
def mock_server():
    """Mock LinkHop server responses."""
    with responses.RequestsMock() as rsps:
        # Mock device list
        rsps.add(
            responses.GET,
            'https://test.linkhop.com/api/devices',
            json=[
                {'id': '1', 'name': 'Laptop', 'is_online': True},
                {'id': '2', 'name': 'Phone', 'is_online': False}
            ]
        )
        
        # Mock send message
        rsps.add(
            responses.POST,
            'https://test.linkhop.com/api/messages',
            json={'id': 'msg-123', 'status': 'queued'},
            status=201
        )
        
        yield rsps

def test_end_to_end_send(mock_server):
    """Test complete send flow."""
    from click.testing import CliRunner
    from linkhop_cli.cli import cli
    
    runner = CliRunner(env={'LINKHOP_TOKEN': 'test_token'})
    result = runner.invoke(cli, [
        '--server', 'https://test.linkhop.com',
        'send', 'https://example.com',
        '--to', 'Laptop',
        '--type', 'url',
        '--yes'
    ])
    
    assert result.exit_code == 0
    assert 'Sent' in result.output
```

### 8.3 Manual Testing Checklist

**Installation:**
- [ ] Install from PyPI works
- [ ] Install from source works
- [ ] Binary distribution works (if applicable)

**Authentication:**
- [ ] Login with token works
- [ ] Logout clears token
- [ ] Invalid token shows error
- [ ] Expired token prompts re-login

**Send Flow:**
- [ ] Interactive send works
- [ ] Non-interactive send works
- [ ] URL detection works
- [ ] Device picker shows all devices
- [ ] Recent devices appear first
- [ ] Send to multiple devices works

**Inbox:**
- [ ] Inbox displays messages
- [ ] JSON output is valid
- [ ] Limit flag works
- [ ] Type filter works

**Error Handling:**
- [ ] Server unreachable shows clear error
- [ ] 401 error prompts re-auth
- [ ] Network timeout handled gracefully
- [ ] Invalid device name shows suggestions

---

## 9. Documentation

### 9.1 README.md Structure

```markdown
# LinkHop CLI

Command-line interface for LinkHop - send links and text between devices.

## Installation

```bash
pip install linkhop-cli
```

## Quick Start

```bash
# Login
lh login

# Send URL to laptop
lh send https://example.com --to laptop

# Check inbox
lh inbox
```

## Commands

- `lh send` - Send a message
- `lh inbox` - View inbox
- `lh devices` - List devices
- `lh auth login/logout` - Authentication

## Configuration

Environment variables:
- `LINKHOP_TOKEN` - Device token
- `LINKHOP_SERVER` - Server URL (default: https://linkhop.example.com)

## Scripting

```bash
# Send clipboard content
pbpaste | lh send --to phone --yes

# Get unread count
lh inbox --count
```
```

### 9.2 Man Page

Generate man page from Markdown:
```bash
pandoc docs/lh.1.md -s -t man -o docs/lh.1
```

---

## 10. Implementation Roadmap

### Phase 1: MVP (v1.0)

- [ ] Basic CLI structure
- [ ] Send command (interactive + non-interactive)
- [ ] Inbox command
- [ ] Device picker
- [ ] Authentication (token-based)
- [ ] PyPI distribution

### Phase 2: Enhanced (v1.1)

- [ ] Fuzzy device search
- [ ] Recent devices
- [ ] Better error messages
- [ ] JSON output mode
- [ ] Shell completions (bash, zsh, fish)

### Phase 3: Polish (v1.2)

- [ ] QR code login
- [ ] Homebrew formula
- [ ] Binary releases
- [ ] Documentation site

---

## Appendix: File Structure

```
linkhop-cli/
├── pyproject.toml
├── README.md
├── LICENSE
├── Makefile
├── src/
│   └── linkhop_cli/
│       ├── __init__.py
│       ├── __main__.py
│       ├── cli.py
│       ├── api.py
│       ├── auth.py
│       ├── config.py
│       ├── device_picker.py
│       ├── inbox.py
│       ├── utils.py
│       └── commands/
│           ├── __init__.py
│           ├── send.py
│           ├── inbox.py
│           ├── devices.py
│           └── auth.py
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_cli.py
│   ├── test_api.py
│   └── test_auth.py
├── docs/
│   ├── CLI.md
│   └── lh.1.md
└── scripts/
    └── release.sh
```

---

**Document Status:** Draft v1.0.0
**Last Updated:** 2026-03-26
**Next Review:** Before CLI implementation
