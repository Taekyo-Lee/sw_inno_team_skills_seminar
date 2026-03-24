#!/bin/sh
set -e

# If gemini-cli-fork is mounted, create a wrapper script so `gemini` is on PATH
if [ -d "/opt/gemini-cli-fork/packages/cli" ]; then
  cat > /usr/local/bin/gemini <<'WRAPPER'
#!/bin/sh
exec node /opt/gemini-cli-fork/packages/cli/dist/index.js "$@"
WRAPPER
  chmod +x /usr/local/bin/gemini
fi

# Rewrite opencode config: replace 127.0.0.1 with host.docker.internal
# so the container can reach the host's proxy
if [ -f /root/.config/opencode/config.json ]; then
  mkdir -p /root/.config-docker/opencode
  sed 's/127\.0\.0\.1/host.docker.internal/g' /root/.config/opencode/config.json \
    > /root/.config-docker/opencode/config.json
  export XDG_CONFIG_HOME=/root/.config-docker
fi

exec "$@"
