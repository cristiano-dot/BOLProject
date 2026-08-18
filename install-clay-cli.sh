#!/bin/bash
mkdir -p ~/.config/clay/bin
curl -fL \
  "https://github.com/clay-run/agent-plugins/releases/download/clay-cli-v0.1.14/clay-linux-x64" \
  -o ~/.config/clay/bin/clay-0.1.14-linux-x64
chmod +x ~/.config/clay/bin/clay-0.1.14-linux-x64
