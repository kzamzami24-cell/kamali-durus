#!/usr/bin/env python3
"""يحدّث data/raw.json من يوتيوب.

- إن وُجد المتغير YT_API_KEY تُستعمل YouTube Data API v3 (الأدق والأسرع).
- وإلا يُستعمل yt-dlp دون مفتاح.

القوائم التي يتعذّر جلبها تبقى كما كانت، فلا يضيع شيء بسبب خطأ عابر.
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw.json')
SRC = os.path.join(ROOT, 'data', 'sources.json')
KEY = os.environ.get('YT_API_KEY', '').strip()


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------- YouTube Data API ----------------
def api(path, **params):
    params['key'] = KEY
    url = 'https://www.googleapis.com/youtube/v3/' + path + '?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            if attempt == 2: raise
            time.sleep(2 + attempt * 3)


def iso_dur(s):
    m = re.match(r'P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', s or '')
    if not m: return 0
    d, h, mi, se = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + se


def api_channel(handle):
    j = api('channels', part='id,contentDetails,snippet', forHandle='@' + handle)
    it = (j.get('items') or [None])[0]
    if not it: raise RuntimeError('channel not found ' + handle)
    return it['id'], it['contentDetails']['relatedPlaylists']['uploads']


def api_channel_playlists(cid):
    out, tok = [], None
    while True:
        j = api('playlists', part='snippet,contentDetails', channelId=cid, maxResults=50, **({'pageToken': tok} if tok else {}))
        out += [(p['id'], p['snippet']['title']) for p in j.get('items', [])]
        tok = j.get('nextPageToken')
        if not tok: return out


def api_playlist(pid, limit=None):
    items, tok, title, channel = [], None, None, ''
    try:
        meta = api('playlists', part='snippet', id=pid)
        if meta.get('items'):
            sn = meta['items'][0]['snippet']; title = sn['title']; channel = sn.get('channelTitle', '')
    except Exception:
        pass
    while True:
        j = api('playlistItems', part='snippet,contentDetails,status', playlistId=pid, maxResults=50, **({'pageToken': tok} if tok else {}))
        for it in j.get('items', []):
            vid = it['contentDetails']['videoId']; t = it['snippet']['title']
            if t in ('Private video', 'Deleted video'): continue
            items.append({'v': vid, 't': t, 'd': 0, 'p': it['contentDetails'].get('videoPublishedAt', '')})
        tok = j.get('nextPageToken')
        if not tok or (limit and len(items) >= limit): break
    # المدد
    for i in range(0, len(items), 50):
        chunk = items[i:i + 50]
        j = api('videos', part='contentDetails,status', id=','.join(x['v'] for x in chunk))
        dd = {v['id']: iso_dur(v['contentDetails'].get('duration')) for v in j.get('items', [])}
        for x in chunk: x['d'] = dd.get(x['v'], -1)
    items = [x for x in items if x['d'] != -1]
    return title, channel, items


# ---------------- yt-dlp ----------------
def ytdlp(url, end=None):
    cmd = ['yt-dlp', '--flat-playlist', '-J', '--no-warnings', '--extractor-args', 'youtubetab:approximate_date']
    if end: cmd += ['--playlist-end', str(end)]
    r = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=600)
    if r.returncode != 0: raise RuntimeError(r.stderr.strip()[-300:])
    return json.loads(r.stdout)


def dl_channel_playlists(handle):
    j = ytdlp(f'https://www.youtube.com/@{handle}/playlists')
    return [(e['id'], e.get('title') or '') for e in j.get('entries', []) if e.get('id', '').startswith(('PL', 'OL'))]


def dl_playlist(pid, limit=None):
    j = ytdlp('https://www.youtube.com/playlist?list=' + pid, end=limit)
    items = []
    for e in j.get('entries', []) or []:
        if not e or not e.get('id'): continue
        t = e.get('title') or ''
        if t in ('[Private video]', '[Deleted video]'): continue
        if not e.get('duration') and (e.get('availability') or '') not in ('', 'public', 'unlisted'): continue
        items.append({'v': e['id'], 't': t, 'd': int(e.get('duration') or 0)})
    return j.get('title'), (j.get('channel') or j.get('uploader') or ''), items


# ---------------- الدمج ----------------
def main():
    src = json.load(open(SRC, encoding='utf-8'))
    raw = json.load(open(RAW, encoding='utf-8')) if os.path.exists(RAW) else {'playlists': {}}
    P = raw['playlists']
    excluded = set(src.get('exclude', []))
    get_pl = api_playlist if KEY else dl_playlist
    log('mode:', 'api' if KEY else 'yt-dlp')

    targets = {}  # pid -> channel handle (للقوائم الرسمية) أو ''
    latest = []
    for ch in src['channels']:
        h = ch['handle']
        try:
            if KEY:
                cid, uploads = api_channel(h)
                pls = api_channel_playlists(cid)
                _, _, up = api_playlist(uploads, limit=40)
            else:
                pls = dl_channel_playlists(h)
                _, _, up = dl_playlist_uploads(h)
            for pid, _ in pls: targets[pid] = h
            if ch.get('rank', 9) == 0:
                latest = [x['v'] for x in up[:40]]
                for x in up[:40]:
                    raw.setdefault('videos_extra', {})[x['v']] = {'t': x['t'], 'd': x['d']}
            log(f'@{h}: {len(pls)} playlists')
        except Exception as e:
            log(f'!! channel @{h} failed: {e}')
            for pid, p in P.items():
                if p.get('channel') == h: targets[pid] = h
    for pid in src.get('extra_playlists', []):
        targets.setdefault(pid, P.get(pid, {}).get('channel', ''))

    changed = 0
    for pid, h in targets.items():
        if pid in excluded: continue
        old = P.get(pid)
        try:
            title, channel, items = get_pl(pid)
        except Exception as e:
            log(f'!! {pid} failed: {str(e)[:200]}'); continue
        if old and len(items) < 0.5 * len(old['items']):
            log(f'!! {pid} shrank {len(old["items"])} -> {len(items)}; keeping old'); continue
        if not items: continue
        # احتفظ بالمدد المعروفة إن لم ترجع
        oldd = {x['v']: x.get('d', 0) for x in (old or {}).get('items', [])}
        for x in items:
            if not x.get('d'): x['d'] = oldd.get(x['v'], 0)
            x.pop('p', None)
        new = {'id': pid, 'title': title or (old or {}).get('title', pid),
               'channel': h or (old or {}).get('channel', '') or channel, 'items': items}
        if new != old:
            changed += 1
            if old:
                added = {x['v'] for x in items} - {x['v'] for x in old['items']}
                if added: log(f'+ {len(added)} new in {new["title"]}')
            else:
                log(f'+ new playlist {new["title"]} ({len(items)})')
        P[pid] = new
        time.sleep(0.3)

    raw['latest'] = latest
    raw['fetched'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    json.dump(raw, open(RAW, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    log(f'done: {changed} playlists changed, {len(latest)} latest uploads')


def dl_playlist_uploads(handle):
    j = ytdlp(f'https://www.youtube.com/@{handle}/videos', end=40)
    items = [{'v': e['id'], 't': e.get('title') or '', 'd': int(e.get('duration') or 0)}
             for e in j.get('entries', []) or [] if e and e.get('id')]
    return None, handle, items


if __name__ == '__main__':
    main()
