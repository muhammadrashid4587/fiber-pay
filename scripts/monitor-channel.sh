#!/bin/bash
for i in $(seq 1 30); do
  sleep 10
  STATE=$(curl -s -X POST http://127.0.0.1:8227 \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"list_channels","params":[{}],"id":1}' \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
channels = data.get('result', {}).get('channels', [])
if not channels:
    print('No channels')
else:
    for ch in channels:
        print(ch['state']['state_name'] + ' (' + ch['state']['state_flags'] + ')')
" 2>&1)
  echo "Check $i ($(date +%H:%M:%S)): $STATE"
  if echo "$STATE" | grep -q "CHANNEL_READY"; then
    echo "Channel is READY!"
    break
  fi
done
