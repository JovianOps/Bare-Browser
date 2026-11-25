import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
keep = set()
# always include head and tail
for j in range(min(5, len(lines))):
    keep.add(j)
for j in range(max(0, len(lines)-25), len(lines)):
    keep.add(j)
for i, l in enumerate(lines):
    ll = l.lower()
    if re.search(r'\berror\b', ll) or re.search(r'\bfailed\b', ll) or 'panicked' in ll or 'caused by' in ll or 'warning:' in ll:
        for j in range(max(0, i-2), min(len(lines), i+4)):
            keep.add(j)
out_idx = sorted(keep)[:60]
# add meta
meta = f"[emit_cargo_errors] total_lines={len(lines)}"
msg = meta.replace('%','%25')
print(f"::error file={path}::{msg}")
for i in out_idx:
    l = lines[i]
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::L{i+1}: {msg}")
