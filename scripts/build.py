#!/usr/bin/env python3
"""يبني ملف catalog.json من data/raw.json.

الخطوات:
1. توحيد المقاطع المعاد رفعها (نفس المدة + عنوان متقارب) تحت معرّف واحد.
2. دمج قوائم التشغيل المتطابقة تقريبًا (القائمة نفسها في أكثر من قناة) في سلسلة واحدة.
3. إسناد كل مقطع إلى سلسلة واحدة فقط حتى لا يتكرر.
4. ترتيب الدروس بحسب رقم الدرس إن وُجد، وتصنيف السلاسل.
"""
import json, re, sys, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw.json')
SRC = os.path.join(ROOT, 'data', 'sources.json')
OUT = os.path.join(ROOT, 'catalog.json')

DIAC = re.compile(r'[ؐ-ًؚ-ٰٟۖ-ۭـ]')
STOP = set('الشيخ سعيد الكملي الكمل للشيخ د الدكتور بن محمد فضيلة لفضيلة من في و ال على عن الى مع'.split())
SERIES_WORDS = set('الجزء جزء الدرس درس الحلقه حلقه المجلس مجلس شرح سلسله برنامج'.split())


def norm(t):
    t = DIAC.sub('', t or '')
    t = re.sub('[إأآا]', 'ا', t).replace('ة', 'ه').replace('ى', 'ي')
    t = re.sub(r'[^\w\s]|_', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def _stem(w):
    if w.startswith('وال') and len(w) > 5: w = w[1:]
    if w.startswith('ال') and len(w) > 4: w = w[2:]
    return w


def toks(t, drop_series=True):
    return {_stem(w) for w in norm(t).split()
            if len(w) > 1 and w not in STOP and not (drop_series and w in SERIES_WORDS) and not w.isdigit()}


ORD = {}
_units = ['الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر']
_unitsf = ['الاولي', 'الثانيه', 'الثالثه', 'الرابعه', 'الخامسه', 'السادسه', 'السابعه', 'الثامنه', 'التاسعه', 'العاشره']
for i, (m, f) in enumerate(zip(_units, _unitsf), 1):
    ORD[m] = i; ORD[f] = i
ORD['الاخير'] = 999; ORD['والاخير'] = 999


def lesson_no(title):
    n = norm(title)
    m = re.search(r'(?:الدرس|درس|الحلقه|حلقه|المجلس|مجلس|الجزء|جزء|سيره الحبيب|مجالس الموطا|موطا|مالك)\s*(\d{1,4})', n)
    if m: return int(m.group(1))
    m = re.search(r'(\d{1,4})\s*(?:من|/)\s*\d{1,4}', n)
    if m: return int(m.group(1))
    m = re.match(r'^\s*(\d{1,4})\b', n)
    if m: return int(m.group(1))
    m = re.search(r'(?:الحلقه|الجزء|المجلس|الدرس)\s+(ال\w+)(?:\s+(?:و)?(عشر|وعشرون|عشرون))?', n)
    if m and m.group(1) in ORD:
        base = ORD[m.group(1)]
        if m.group(2):
            base += 10 if 'عشر' == m.group(2) else 20
        return base
    m = re.search(r'(?:الحلقه|الجزء|المجلس|الدرس)\s+(\d+)', n)
    if m: return int(m.group(1))
    # احتياط للعناوين المترجمة إلى الإنجليزية
    m = re.search(r'(?:sessions?|lesson|episode|part|lecture)\s*(?:of\s+\w+(?:\s+\w+)?\s*)?(\d{1,4})', n, re.I)
    if m: return int(m.group(1))
    m = re.search(r'(\d{1,4})', n)
    return None


def nums(t):
    return set(re.findall(r'\d+', norm(t)))


CATS = [
    ('quran', 'القرآن وعلومه', ['تفسير', 'تفسير', 'القران', 'سوره', 'التفسير', 'علوم القران', 'ايه وحكايه', 'القراءات']),
    ('fiqh', 'الفقه والحديث', ['موطا', 'الموطا', 'فقه', 'الفقه', 'رساله', 'الرساله', 'المسالك', 'فتاوي', 'مواقيت', 'اصول', 'الصيام', 'الطهاره', 'الصلاه', 'الاحكام', 'المالكي', 'كرسي', 'العقيده']),
    ('sira', 'السيرة والتاريخ والتراجم', ['سيره', 'السيره', 'المبتدا', 'اخبار العرب', 'مالك بن انس', 'سيره الامام', 'تراجم', 'التراجم', 'الصحابه', 'الفتنه', 'التاريخ', 'اسوه', 'الارجوزه', 'مشاهد']),
    ('adab', 'الأدب واللغة والشعر', ['شعر', 'الشعر', 'لاميه', 'منظومه', 'منظومات', 'المعلقات', 'عنوان الحكم', 'الالبيري', 'النحو', 'اشذاء']),
    ('waaz', 'مواعظ ومحاضرات', ['رمضان', 'مواعظ', 'خطب', 'محاضرات', 'نصائح', 'الاداب', 'حفظ', 'رحاب']),
]


def categorize(title):
    n = norm(title)
    for key, _, words in CATS:
        if any(w in n for w in words):
            return key
    return 'waaz'


def main():
    raw = json.load(open(RAW, encoding='utf-8'))
    src = json.load(open(SRC, encoding='utf-8'))
    official = {c['handle']: c['rank'] for c in src['channels']}
    catch_all = set(src.get('catch_all', []))
    exclude = set(src.get('exclude', []))
    renames = src.get('rename', {})
    PL = {k: v for k, v in raw['playlists'].items() if k not in exclude and v['items']}

    for pid, p in PL.items():
        if official.get(p['channel'], 9) < 9: continue
        pt = toks(p['title'])
        p['items'] = [it for it in p['items'] if re.search(r'كمل|kamal', norm(it['t']), re.I) or (toks(it['t']) & pt)]
    PL = {k: v for k, v in PL.items() if v['items']}
    for p in PL.values():
        if any(it.get('d') for it in p['items']):
            p['items'] = [it for it in p['items'] if it.get('d')]

    # ---- 1. فهرس المقاطع
    V = {}
    in_pl = defaultdict(set)
    for pid, p in PL.items():
        for it in p['items']:
            x = V.setdefault(it['v'], {'t': it['t'], 'd': it.get('d') or 0})
            if not x['d'] and it.get('d'): x['d'] = it['d']
            in_pl[it['v']].add(pid)

    def prank(pid):
        return official.get(PL[pid]['channel'], 9)

    def vrank(v):
        return (min(prank(p) for p in in_pl[v]), -len(in_pl[v]), v)

    # استبعاد قوائم المقتطفات غير الرسمية (متوسط المدة أقل من 10 دقائق)
    for pid in list(PL):
        p = PL[pid]
        if prank(pid) < 9 or pid in src.get('keep', []):
            continue
        ds = sorted(V[i['v']]['d'] for i in p['items'] if V[i['v']]['d'])
        if ds and ds[len(ds) // 2] < 600:
            del PL[pid]
    in_pl = defaultdict(set, {v: {p for p in s if p in PL} for v, s in in_pl.items()})
    V = {v: x for v, x in V.items() if in_pl[v]}

    # ---- 2. توحيد المقاطع المعاد رفعها
    canon = {}

    def find(v):
        while canon.get(v, v) != v:
            v = canon[v]
        return v

    items = sorted((x['d'], v) for v, x in V.items() if x['d'] >= 240)
    for i, (d, v) in enumerate(items):
        j = i + 1
        while j < len(items) and items[j][0] - d <= 1:
            w = items[j][1]; j += 1
            if in_pl[v] & in_pl[w]:
                continue
            na, nb = nums(V[v]['t']), nums(V[w]['t'])
            if na and nb and not (na & nb):
                continue
            a, b = toks(V[v]['t'], False), toks(V[w]['t'], False)
            jac = len(a & b) / max(1, len(a | b))
            if (jac >= 0.5 and d >= 600) or jac >= 0.6 or (jac >= 0.3 and d >= 1500):
                ra, rb = find(v), find(w)
                if ra != rb:
                    keep, drop = sorted([ra, rb], key=vrank)
                    canon[drop] = keep

    def plv(pid):
        seen, out = set(), []
        for it in PL[pid]['items']:
            c = find(it['v'])
            if c not in seen:
                seen.add(c); out.append(c)
        return out

    vids = {pid: plv(pid) for pid in PL}

    # ---- 3. دمج القوائم المتطابقة
    parent = {pid: pid for pid in PL}

    def uf(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x

    pids = [p for p in PL if p not in catch_all]
    # قائمة غير رسمية محتواة تقريبًا في قائمة أكبر = نسخة جزئية، تُحذف
    for a in list(pids):
        if prank(a) < 9: continue
        sa = set(vids[a])
        for b in pids:
            if b == a or len(vids[b]) <= len(sa): continue
            if len(sa & set(vids[b])) >= 0.9 * len(sa):
                pids.remove(a); break
    for i, a in enumerate(pids):
        sa = set(vids[a])
        ta = toks(PL[a]['title'])
        for b in pids[i + 1:]:
            sb = set(vids[b])
            inter = len(sa & sb)
            if not inter: continue
            lo, hi = min(len(sa), len(sb)), max(len(sa), len(sb))
            ov = inter / lo
            share = bool(ta & toks(PL[b]['title']))
            if ov >= 0.6 and ((share and lo >= 0.6 * hi) or (ov >= 0.95 and lo >= 0.85 * hi)):
                parent[uf(a)] = uf(b)

    for group in src.get('merge', []):
        g = [x for x in group if x in parent]
        for x in g[1:]:
            parent[uf(x)] = uf(g[0])

    clusters = defaultdict(list)
    for p in pids:
        clusters[uf(p)].append(p)

    series = []
    for root, members in clusters.items():
        members.sort(key=lambda p: (prank(p), -len(vids[p])))
        for g in src.get('merge', []):
            if g[0] in members:
                members.remove(g[0]); members.insert(0, g[0]); break
        head = members[0]
        biggest = max(members, key=lambda p: len(vids[p]))
        order, seen = [], set()
        for p in [biggest] + [m for m in members if m != biggest]:
            for v in vids[p]:
                if v not in seen:
                    seen.add(v); order.append(v)
        series.append({'id': head, 'members': members, 'videos': order,
                       'rank': prank(head), 'title': renames.get(head, PL[head]['title'])})

    # ---- 4. كل مقطع في سلسلة واحدة
    owner_of = defaultdict(list)
    for s in series:
        for v in s['videos']:
            owner_of[v].append(s)
    for v, ss in owner_of.items():
        if len(ss) > 1:
            best = min(ss, key=lambda s: (s['rank'] >= 9, len(s['videos']), s['rank']))
            for s in ss:
                if s is not best:
                    s.setdefault('drop', set()).add(v)
    misc = []
    final = []
    for s in series:
        drop = s.get('drop', set())
        kept = [v for v in s['videos'] if v not in drop]
        if len(kept) < 2 and drop:
            misc.extend(kept)
            continue
        final.append((s, kept))

    assigned = {v for s, kept in final for v in kept}
    for pid in PL:
        if pid in catch_all:
            for v in vids[pid]:
                if v not in assigned: misc.append(v)
    seen = set(); misc = [v for v in misc if not (v in seen or seen.add(v)) and v not in assigned]

    # ---- 5. الترتيب والتصنيف
    out_series = []
    for s, kept in final:
        if not kept: continue
        if len(s['members']) > 1:
            byno = {}
            dd = []
            for v in kept:
                n = lesson_no(V[v]['t'])
                if n is None: dd.append(v); continue
                dup = False
                for w in byno.get(n, []):
                    a, b = toks(V[v]['t'], False), toks(V[w]['t'], False)
                    if len(a & b) / max(1, len(a | b)) >= 0.5 and (not V[v]['d'] or not V[w]['d'] or abs(V[v]['d'] - V[w]['d']) <= 20):
                        dup = True; canon[v] = w; break
                if not dup:
                    byno.setdefault(n, []).append(v); dd.append(v)
            kept = dd
        nums_ = [lesson_no(V[v]['t']) for v in kept]
        numbered = sum(n is not None for n in nums_)
        if numbered >= 0.6 * len(kept):
            idx = {v: i for i, v in enumerate(kept)}
            kept = sorted(kept, key=lambda v: (lesson_no(V[v]['t']) is None, lesson_no(V[v]['t']) or 0, idx[v]))
        title = re.sub(r'\(?\s*(?:لفضيلة|للشيخ|الشيخ|العلامة|ش\.)?\s*(?:الشيخ\s*)?(?:الدكتور\s*|د\.?\s*)?سعي[دج] (?:بن محمد )?الكملي\s*\)?', ' ', s['title'])
        title = re.sub(r'\s+', ' ', title).strip(' -ـ|/:')
        title = s['title'] if s['id'] in renames else title
        out_series.append({
            'id': s['id'], 'title': title or s['title'],
            'cat': src.get('category', {}).get(s['id']) or categorize(s['title'] + ' ' + ' '.join(V[v]['t'] for v in kept[:3])),
            'official': s['rank'] < 9,
            'sources': [{'id': m, 'channel': PL[m]['channel']} for m in s['members']],
            'videos': kept,
        })
    assigned_all = {v for x in out_series for v in x['videos']} | set(misc)
    fresh = []
    for v in raw.get('latest', []):
        v = find(v) if v in V else v
        if v in assigned_all or v in fresh: continue
        x = raw.get('videos_extra', {}).get(v)
        if not x: continue
        V.setdefault(v, {'t': x['t'], 'd': x.get('d') or 0})
        fresh.append(v)
    if fresh:
        out_series.append({'id': 'latest', 'title': 'أحدث ما رُفع ولم يُضمّ إلى قائمة بعد', 'cat': 'misc', 'official': True,
                           'sources': [{'id': 'UU' + src['channels'][0].get('channel_id', '')[2:], 'channel': src['channels'][0]['handle']}],
                           'videos': fresh})
    if misc:
        out_series.append({'id': 'misc', 'title': 'مقاطع ومحاضرات متفرقة', 'cat': 'misc', 'official': True,
                           'sources': [{'id': p, 'channel': PL[p]['channel']} for p in catch_all if p in PL],
                           'videos': misc})

    rank_cat = {k: i for i, (k, _, _) in enumerate(CATS)}
    out_series.sort(key=lambda s: (rank_cat.get(s['cat'], 99), s['id'] != 'latest', -len(s['videos'])))
    used = {v for s in out_series for v in s['videos']}
    cat = {
        'updated': raw.get('fetched'),
        'categories': [{'id': k, 'title': t} for k, t, _ in CATS] + [{'id': 'misc', 'title': 'متفرقات'}],
        'series': out_series,
        'videos': {v: {'t': V[v]['t'], 'd': V[v]['d']} for v in used},
        'latest': raw.get('latest', []),
    }
    json.dump(cat, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f"series={len(out_series)} videos={len(used)} merged_dupes={len(canon)} misc={len(misc)}", file=sys.stderr)


if __name__ == '__main__':
    main()
