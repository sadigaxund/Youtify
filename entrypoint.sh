#!/bin/bash
set -e

# Use environment variables or defaults
PUID=${PUID:-568}
PGID=${PGID:-568}

echo "Starting with PUID: $PUID and PGID: $PGID"

# Create group if it doesn't exist
if ! getent group $PGID > /dev/null 2>&1; then
    groupadd -g $PGID apps
fi

# Get group name for this GID
GROUP_NAME=$(getent group $PGID | cut -d: -f1)

# Create user if it doesn't exist
if ! getent passwd $PUID > /dev/null 2>&1; then
    useradd -u $PUID -g $PGID -m -s /bin/bash apps
fi

# Only chown the app directory (never mounted volumes)
chown -R $PUID:$PGID /app

# Validate save directory permissions if configured
if [ -n "$SAVE_DIRECTORY" ]; then
    if [ -d "$SAVE_DIRECTORY" ]; then
        # Test write permission as the target user
        if ! gosu $PUID:$PGID test -w "$SAVE_DIRECTORY"; then
            echo ""
            echo "================================================================"
            echo "WARNING: SAVE_DIRECTORY ($SAVE_DIRECTORY) is not writable"
            echo "         by user $PUID:$PGID"
            echo ""
            echo "  Fix: Set PUID/PGID to match the volume owner, e.g.:"
            echo "    docker run -e PUID=\$(id -u) -e PGID=\$(id -g) ..."
            echo ""
            echo "  Or fix permissions on the host:"
            echo "    chown $PUID:$PGID $SAVE_DIRECTORY"
            echo "================================================================"
            echo ""
            echo "Falling back to browser download mode."
            unset SAVE_DIRECTORY
        else
            echo "Save directory OK: $SAVE_DIRECTORY (writable by $PUID:$PGID)"
        fi
    else
        echo "Save directory does not exist, will be created: $SAVE_DIRECTORY"
        # Try to create it as the target user
        gosu $PUID:$PGID mkdir -p "$SAVE_DIRECTORY" 2>/dev/null || {
            echo "WARNING: Cannot create $SAVE_DIRECTORY as $PUID:$PGID. Falling back to browser download mode."
            unset SAVE_DIRECTORY
        }
    fi
fi

# Switch to the non-root user and execute the command
exec gosu $PUID:$PGID "$@"
