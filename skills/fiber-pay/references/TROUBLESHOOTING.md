# fiber-pay Troubleshooting Guide

Common errors, their causes, and solutions for fiber-pay operations.

## Table of Contents

1. [Installation & Setup Issues](#installation--setup-issues)
2. [Binary Download Issues](#binary-download-issues)
3. [Node Startup Issues](#node-startup-issues)
4. [Payment Issues](#payment-issues)
5. [Channel Issues](#channel-issues)
6. [RPC Connection Issues](#rpc-connection-issues)
7. [Policy Violations](#policy-violations)
8. [Network Issues](#network-issues)
9. [Key Management Issues](#key-management-issues)
10. [Platform-Specific Issues](#platform-specific-issues)

---

## Installation & Setup Issues

### Error: `command not found: fiber-pay`

**Cause**: CLI not linked globally or not in PATH.

**Solution**:
```bash
# Re-link the CLI
cd /path/to/fiber-pay
pnpm link --global

# Verify it's linked
which fiber-pay

# If still not found, add to PATH
export PATH="$PATH:$(pnpm bin -g)"
```

### Error: `Cannot find module 'fiber-pay'`

**Cause**: Dependencies not installed or build not run.

**Solution**:
```bash
cd /path/to/fiber-pay
pnpm install
pnpm build
pnpm link --global
```

### Error: `EACCES: permission denied`

**Cause**: Insufficient permissions for global link.

**Solution**:
```bash
# Option 1: Use sudo (not recommended)
sudo pnpm link --global

# Option 2: Fix npm/pnpm permissions
mkdir -p ~/.pnpm-global
pnpm config set global-dir ~/.pnpm-global
export PATH="$PATH:~/.pnpm-global/bin"
```

---

## Binary Download Issues

### Error: `BINARY_DOWNLOAD_FAILED: Failed to download fnn binary`

**Cause**: Network connectivity, GitHub rate limiting, or unsupported platform.

**Solution**:
```bash
# Check network connectivity
curl -I https://github.com

# Try with specific version
fiber-pay download --version v0.4.0

# Force re-download
fiber-pay download --force

# Check platform support
uname -m  # Should be x86_64 or arm64
```

**Supported Platforms**:
- macOS: x86_64, arm64 (Apple Silicon via Rosetta)
- Linux: x86_64, arm64
- Windows: x86_64

### Error: `BINARY_NOT_FOUND: fnn binary not found`

**Cause**: Binary not downloaded yet.

**Solution**:
```bash
# Download the binary
fiber-pay download

# Verify installation
ls -la ~/.fiber-pay/bin/fnn
```

### Error: `Platform not supported`

**Cause**: Running on unsupported architecture.

**Solution**:
```bash
# Check your platform
uname -sm

# For Apple Silicon Macs, ensure Rosetta 2 is installed
softwareupdate --install-rosetta

# For other platforms, build from source
git clone https://github.com/nervosnetwork/fiber
cd fiber
cargo build --release
cp target/release/fnn ~/.fiber-pay/bin/
```

### Error: `GitHub API rate limit exceeded`

**Cause**: Too many requests to GitHub API (60/hour for unauthenticated).

**Solution**:
```bash
# Wait 1 hour, or authenticate with GitHub
export GITHUB_TOKEN="your-github-token"
fiber-pay download

# Or download manually
curl -L https://github.com/nervosnetwork/fiber/releases/download/v0.4.0/fnn-macos-x86_64.tar.gz -o fnn.tar.gz
tar -xzf fnn.tar.gz
mkdir -p ~/.fiber-pay/bin
mv fnn ~/.fiber-pay/bin/
chmod +x ~/.fiber-pay/bin/fnn
```

---

## Node Startup Issues

### Error: `NODE_NOT_RUNNING: Fiber node is not running`

**Cause**: Node hasn't been started yet.

**Solution**:
```bash
# Start the node
fiber-pay start

# Check status
fiber-pay status
```

### Error: `Address already in use (port 8227)`

**Cause**: Another process is using the RPC port.

**Solution**:
```bash
# Find process using port 8227
lsof -i :8227

# Kill the process
kill -9 <PID>

# Or use different port
export FIBER_RPC_PORT=8229
fiber-pay start
```

### Error: `Address already in use (port 8228)`

**Cause**: Another process is using the P2P port.

**Solution**:
```bash
# Find process using port 8228
lsof -i :8228

# Kill the process
kill -9 <PID>

# Or use different port
export FIBER_P2P_PORT=8230
fiber-pay start
```

### Error: `Failed to start node: Permission denied`

**Cause**: Insufficient permissions for data directory.

**Solution**:
```bash
# Fix permissions
chmod 755 ~/.fiber-pay
chmod 755 ~/.fiber-pay/bin

# Or use custom data directory
export FIBER_DATA_DIR=/tmp/fiber-pay
fiber-pay start
```

### Error: `Database lock is held`

**Cause**: Previous node instance didn't shut down cleanly.

**Solution**:
```bash
# Remove lock file
rm -f ~/.fiber-pay/fiber/store/LOCK
rm -f ~/.fiber-pay/fiber.pid

# Kill any lingering processes
pkill -9 fnn

# Restart
fiber-pay start
```

### Error: `Failed to connect to CKB node`

**Cause**: CKB RPC endpoint unavailable or incorrect configuration.

**Solution**:
```bash
# Check CKB RPC endpoint in config
cat ~/.fiber-pay/fiber-config.yml

# Test CKB RPC connectivity
curl -X POST http://testnet.ckb.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"get_tip_block_number","params":[],"id":1}'

# Update config if needed
# Edit ~/.fiber-pay/fiber-config.yml and restart
```

---

## Payment Issues

### Error: `INSUFFICIENT_BALANCE: Insufficient balance to send X CKB`

**Cause**: Not enough funds in channels.

**Solution**:
```bash
# Check balance
fiber-pay balance

# Option 1: Open a channel and fund it
fiber-pay channels open --peer <peer-multiaddr> --funding 200

# Option 2: Receive payment from someone
fiber-pay invoice create --amount 100 --description "Funding"

# Option 3: Send less money
fiber-pay pay <invoice> --max-amount 50
```

### Error: `INVOICE_EXPIRED: Payment invoice has expired`

**Cause**: Invoice validity period has passed.

**Solution**:
```bash
# Request a new invoice from the recipient
# Invoices default to 60 minute expiry

# When creating invoices, set longer expiry
fiber-pay invoice create --amount 10 --expiry 180  # 3 hours
```

### Error: `INVOICE_INVALID: Invalid invoice format`

**Cause**: Malformed invoice string.

**Solution**:
```bash
# Verify invoice format
# Should start with "fibt" (testnet) or "fibb" (mainnet)
echo "fibt1qq2d77zqpvle5n2uqkgzlgw..."

# Check for copy-paste errors
# - No extra whitespace
# - Complete string (not truncated)
# - Correct network (fibt for testnet, fibb for mainnet)
```

### Error: `PAYMENT_TIMEOUT: Payment took too long`

**Cause**: Payment routing failed or network congestion.

**Solution**:
```bash
# Check channel states
fiber-pay channels list

# Verify peer connectivity
fiber-pay node info

# Try with higher max fee
fiber-pay pay <invoice> --max-fee 1.0

# If keysend, ensure direct channel exists
fiber-pay channels open --peer <recipient-node-id> --funding 100
```

### Error: `NO_ROUTE_FOUND: No payment route found`

**Cause**: No path of channels between you and recipient.

**Solution**:
```bash
# Option 1: Open direct channel to recipient
fiber-pay channels open --peer <recipient-node-id> --funding 200

# Option 2: Open channel to well-connected hub
fiber-pay channels open \
  --peer /ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo... \
  --funding 200

# Wait for CHANNEL_READY state
fiber-pay channels list
```

### Error: `PAYMENT_FAILED: Payment failed for unknown reason`

**Cause**: Various possible causes (channel state, peer offline, etc.).

**Solution**:
```bash
# Check payment details in error
fiber-pay payment status <payment-hash>

# Check channel states
fiber-pay channels list

# Verify node is running
fiber-pay status

# Check audit logs for details
# (if using TypeScript API)
```

---

## Channel Issues

### Error: `CHANNEL_NOT_FOUND: Invalid channel ID`

**Cause**: Channel doesn't exist or incorrect ID.

**Solution**:
```bash
# List all channels
fiber-pay channels list

# Verify channel ID format (should be hex starting with 0x)
echo "0xabc123..."

# Channel may have been closed
```

### Error: `Channel stuck in NEGOTIATING_FUNDING state`

**Cause**: Waiting for on-chain CKB transaction confirmation.

**Solution**:
```bash
# Check channel status
fiber-pay channels list

# Wait for CKB blockchain confirmation
# Testnet: ~30 seconds
# Mainnet: ~3 minutes

# Check CKB transaction status
# (view in CKB explorer if you have tx hash)

# If stuck for >10 minutes, restart node
fiber-pay stop
fiber-pay start
```

### Error: `INSUFFICIENT_FUNDS: Not enough on-chain CKB for channel`

**Cause**: Need on-chain CKB to fund channel opening.

**Solution**:
```bash
# Check your on-chain CKB balance
fiber-pay node info
# Look for "addresses" field

# Fund your address from faucet (testnet)
# Visit: https://faucet.nervos.org/
# Enter your address from above

# Or transfer CKB from another wallet
```

### Error: `PEER_UNREACHABLE: Cannot connect to peer`

**Cause**: Peer is offline or incorrect multiaddr.

**Solution**:
```bash
# Verify peer multiaddr format
# Should be: /ip4/x.x.x.x/tcp/port/p2p/QmXXX...
echo "/ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo..."

# Test peer connectivity
ping 13.213.128.182

# Try testnet bootnode
fiber-pay channels open \
  --peer /ip4/13.213.128.182/tcp/8228/p2p/Qma5W8xW3oKo24vH5... \
  --funding 200
```

### Error: `MAX_CHANNELS_REACHED: Too many channels`

**Cause**: Policy limit on maximum channels.

**Solution**:
```bash
# Check current channels
fiber-pay channels list

# Close unused channels
fiber-pay channels close <channel-id>

# Or increase policy limit
# (in TypeScript configuration)
policy: {
  channels: {
    maxChannels: 20,  // Increase from 10
  }
}
```

### Error: `CHANNEL_CLOSE_NOT_ALLOWED: Cannot close channel`

**Cause**: Security policy blocks channel closing.

**Solution**:
```bash
# Check policy settings
fiber-pay policy allowance

# Update policy (if using TypeScript API)
policy: {
  channels: {
    allowClose: true,
  }
}

# Or force close (if absolutely necessary)
fiber-pay channels close <channel-id> --force
```

---

## RPC Connection Issues

### Error: `RPC_ERROR: Failed to connect to RPC endpoint`

**Cause**: Node not running or wrong RPC URL.

**Solution**:
```bash
# Check if node is running
fiber-pay status

# Start node if not running
fiber-pay start

# Verify RPC URL
echo $FIBER_RPC_URL  # Should be http://127.0.0.1:8227

# Test RPC connectivity
curl -X POST http://127.0.0.1:8227 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"node_info","params":[],"id":1}'
```

### Error: `RPC timeout`

**Cause**: RPC request taking too long.

**Solution**:
```bash
# Check node status
fiber-pay status

# Restart node if unresponsive
fiber-pay stop
fiber-pay start

# Check system resources
top  # Look for high CPU/memory usage

# Increase timeout (if using TypeScript API)
const client = new FiberRpcClient('http://127.0.0.1:8227', {
  timeout: 60000,  // 60 seconds
});
```

### Error: `JSON-RPC parse error`

**Cause**: Malformed RPC request or response.

**Solution**:
```bash
# Check RPC method name and parameters
# See API.md for correct formats

# Verify node version matches SDK
fiber-pay node info

# Update to latest fnn binary
fiber-pay download --force
```

---

## Policy Violations

### Error: `POLICY_VIOLATION: SPENDING_LIMIT_PER_TX`

**Cause**: Single payment exceeds per-transaction limit.

**Solution**:
```bash
# Check current limits
fiber-pay policy allowance

# Option 1: Reduce payment amount
fiber-pay pay <invoice> --amount 50  # Instead of 150

# Option 2: Increase policy limit (if authorized)
# Update policy configuration in TypeScript
policy: {
  spending: {
    maxPerTransaction: '0x2386f26fc10000',  // Increase limit
  }
}
```

### Error: `POLICY_VIOLATION: SPENDING_LIMIT_PER_WINDOW`

**Cause**: Cumulative spending would exceed window limit.

**Solution**:
```bash
# Check remaining allowance
fiber-pay policy allowance

# Option 1: Wait for window to reset
# Check "windowResetAt" timestamp

# Option 2: Send smaller amount now
fiber-pay pay <invoice> --amount 20

# Option 3: Increase window limit (if authorized)
policy: {
  spending: {
    maxPerWindow: '0xe8d4a51000',  # Increase
  }
}
```

### Error: `POLICY_VIOLATION: RATE_LIMIT_EXCEEDED`

**Cause**: Too many transactions in time window.

**Solution**:
```bash
# Check rate limit status
fiber-pay policy allowance

# Wait for window to reset (usually 1 minute)
sleep 60

# Or increase rate limit (if authorized)
policy: {
  rateLimit: {
    maxTransactions: 20,  # Increase from 10
  }
}
```

### Error: `POLICY_VIOLATION: RATE_LIMIT_COOLDOWN`

**Cause**: Not enough time between consecutive transactions.

**Solution**:
```bash
# Wait for cooldown period
# Usually 1-5 seconds

sleep 5
fiber-pay pay <invoice>

# Or reduce cooldown (if authorized)
policy: {
  rateLimit: {
    cooldownSeconds: 1,  # Reduce from 5
  }
}
```

### Error: `POLICY_VIOLATION: RECIPIENT_BLOCKED`

**Cause**: Recipient is on blocklist.

**Solution**:
```bash
# Verify recipient address/node ID
echo "QmXXXYYYZZZ..."

# Check if it's the correct recipient
# (may be a known scammer)

# Remove from blocklist (if legitimate)
policy: {
  recipients: {
    blocklist: [],  # Remove recipient
  }
}
```

---

## Network Issues

### Error: `Network unreachable`

**Cause**: No internet connection or firewall blocking.

**Solution**:
```bash
# Check internet connectivity
ping google.com

# Check firewall rules
# macOS:
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Linux:
sudo ufw status

# Allow fiber-pay ports
# macOS: System Settings > Network > Firewall > Options
# Linux: sudo ufw allow 8227
#        sudo ufw allow 8228
```

### Error: `Connection refused`

**Cause**: Target service not listening on port.

**Solution**:
```bash
# Check if node is running
fiber-pay status

# Verify ports are open
netstat -an | grep 8227
netstat -an | grep 8228

# Restart node
fiber-pay stop
fiber-pay start
```

### Error: `DNS resolution failed`

**Cause**: Cannot resolve hostname.

**Solution**:
```bash
# Check DNS resolution
nslookup testnet.ckb.dev

# Try alternative DNS
# Add to /etc/resolv.conf:
nameserver 8.8.8.8
nameserver 8.8.4.4

# Or use IP address directly in config
```

---

## Key Management Issues

### Error: `Key not found`

**Cause**: Private key hasn't been generated yet.

**Solution**:
```bash
# Initialize and generate key
fiber-pay start

# Key will be created at ~/.fiber-pay/keys/
ls -la ~/.fiber-pay/keys/
```

### Error: `Failed to decrypt key`

**Cause**: Incorrect password.

**Solution**:
```bash
# Re-enter correct password
fiber-pay start
# (will prompt for password)

# Or set via environment variable
export FIBER_KEY_PASSWORD="correct-password"
fiber-pay start
```

### Error: `Key file corrupted`

**Cause**: Key file was modified or corrupted.

**Solution**:
```bash
# If you have backup, restore it
cp ~/.fiber-pay/keys/main.key.backup ~/.fiber-pay/keys/main.key

# Otherwise, generate new key (⚠️ loses access to old funds)
rm ~/.fiber-pay/keys/main.key
fiber-pay start
```

---

## Platform-Specific Issues

### macOS: Rosetta 2 Issues (Apple Silicon)

**Error**: `exec format error` on M1/M2 Mac

**Solution**:
```bash
# Install Rosetta 2
softwareupdate --install-rosetta

# Verify it's installed
/usr/sbin/sysctl -n machdep.cpu.brand_string

# Re-download binary
fiber-pay download --force
```

### Linux: Missing Libraries

**Error**: `error while loading shared libraries`

**Solution**:
```bash
# Install required libraries
# Ubuntu/Debian:
sudo apt-get update
sudo apt-get install libssl-dev libc6

# CentOS/RHEL:
sudo yum install openssl-devel glibc

# Arch:
sudo pacman -S openssl glibc
```

### Windows: WSL Issues

**Error**: Port binding issues on WSL

**Solution**:
```bash
# Use WSL2 (not WSL1)
wsl --set-version Ubuntu 2

# Or use different ports
export FIBER_RPC_PORT=9227
export FIBER_P2P_PORT=9228
fiber-pay start
```

---

## Getting More Help

### Enable Verbose Logging

```bash
# Set log level
export RUST_LOG=debug
fiber-pay start

# Check node logs
tail -f ~/.fiber-pay/fiber/logs/fiber.log
```

### Collect Debug Information

```bash
# Node status
fiber-pay status

# Balance and channels
fiber-pay balance
fiber-pay channels list

# Node info
fiber-pay node info

# System info
uname -a
node --version
pnpm --version
```

### Report Issues

If you've tried all solutions and still have issues:

1. **GitHub Issues**: https://github.com/nervosnetwork/fiber-pay/issues
2. **Include**:
   - Error message (full output)
   - CLI commands run
   - Platform (macOS/Linux/Windows, arch)
   - Node version
   - Debug information (from above)

3. **Fiber Network Issues**: https://github.com/nervosnetwork/fiber/issues

---

## Quick Reference: Common Commands

```bash
# Download binary
fiber-pay download

# Start node
fiber-pay start

# Check status
fiber-pay status

# Stop node
fiber-pay stop

# Check balance
fiber-pay balance

# List channels
fiber-pay channels list

# Check policy
fiber-pay policy allowance

# Node info
fiber-pay node info
```

---

For more documentation, see:
- [SKILL.md](../SKILL.md) - Main skill guide
- [API.md](API.md) - Complete API reference
- [SECURITY.md](SECURITY.md) - Security policies
