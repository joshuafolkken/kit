#!/bin/bash
# Caddy のアクセスログを見やすく表示するスクリプト
# 使用方法: ./scripts/caddy-logs.sh
# chmod +x scripts/caddy-logs.sh
#
# scp scripts/caddy-logs.sh deploy-joshuastudio:/var/www/talk-svelte/scripts/ && \
# ssh deploy-joshuastudio "chmod +x /var/www/talk-svelte/scripts/caddy-logs.sh && echo '✅ File uploaded and permissions set'"

sudo tail -n 100 -f /var/log/caddy/access.log | jq -r '
  def status_symbol(status):
    if status >= 200 and status < 300 then "✓"
    elif status >= 300 and status < 400 then "→"
    elif status >= 400 then "✗"
    else "?" end;
  def extract_os(ua):
    if ua == null or ua == "-" then "Unknown"
    elif (ua | contains("Windows NT")) then "Windows"
    elif (ua | contains("Macintosh")) then "macOS"
    elif (ua | contains("iPhone")) then "iOS"
    elif (ua | contains("iPad")) then "iPadOS"
    elif (ua | contains("Android")) then "Android"
    elif (ua | contains("Linux")) then "Linux"
    else "Unknown" end;
  def extract_browser(ua):
    if ua == null or ua == "-" then "Unknown"
    elif (ua | contains("Chrome")) and (ua | contains("Edg") | not) then "Chrome"
    elif (ua | contains("Edg")) then "Edge"
    elif (ua | contains("Safari")) and (ua | contains("Chrome") | not) then "Safari"
    elif (ua | contains("Firefox")) then "Firefox"
    elif (ua | contains("Opera")) then "Opera"
    else "Other" end;
  def host_label:
    (.request.host // (.request.headers.Host[0] // "-"))
    | gsub("\\.joshuafolkken\\.com$"; "")
    | gsub("^joshuafolkken\\.com$"; "");
  "[\(.ts | . + 32400 | strftime("%H:%M:%S"))] " +
  status_symbol(.status) + " " +
  "\(.status) " +
  "\(.request.method) " +
  "\(.duration * 1000 | floor)ms " +
  "\(.request.remote_ip // "-") " +
  host_label + "\(.request.uri) " +
  "(\(.size)) " +
  "[\(extract_os(.request.headers."User-Agent"[0]))/\(extract_browser(.request.headers."User-Agent"[0]))]"
'