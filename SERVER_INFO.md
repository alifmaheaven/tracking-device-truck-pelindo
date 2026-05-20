# Server Connection Details

The target server for this application is a remote Linux environment. Below are the access details:

- **Host**: `ssh-map-ttl.freeat.me`
- **Username**: `ptc`
- **Password**: `ptc@2026#!`

## SSH Connection Protocol

When making terminal connections over SSH to execute commands on the remote server, use `sshpass` to provide the password, and pass the password via `echo` into `sudo -S` if elevated privileges are required. 

**Standard Execution format:**
```bash
sshpass -p "ptc@2026#!" ssh -o StrictHostKeyChecking=no ptc@ssh-map-ttl.freeat.me "echo 'ptc@2026#!' | sudo -S <YOUR_COMMAND>"
```

### Example: Checking Directory Structure
```bash
sshpass -p "ptc@2026#!" ssh -o StrictHostKeyChecking=no ptc@ssh-map-ttl.freeat.me "echo 'ptc@2026#!' | sudo -S ls -la /"
```
