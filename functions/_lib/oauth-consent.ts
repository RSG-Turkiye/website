// The consent page and the error page of /oauth/authorize (plan 6, Call 12):
// plain HTML rendered here, not an Astro page, because it needs the request's
// parameters, the session and the member's live areas in one response. No
// script, no external request, inline CSS only. Both languages sit side by
// side in this file (not ui.ts) so the Function bundle stays small. Every
// string that is not ours (client name, host, redirect URI, OAuth values) goes
// through `esc`.

export type Lang = 'tr' | 'en';
export type ErrorKey = 'signin' | 'client' | 'long' | 'request' | 'area' | 'days' | 'codes' | 'full' | 'none';

export interface ConsentArea { area: string; ticked: boolean; level: 'read' | 'draft' }

export interface ConsentView {
  lang: Lang;
  /** 'form' is the choice; 'noAreas' (the member holds no area) and 'full' (5 live connections) offer Deny only. */
  state: 'form' | 'noAreas' | 'full';
  clientName: string;
  /** The CIMD URL's host; null for a registered (DCR) client. */
  clientHost: string | null;
  /** Where the code will go: the whole redirect URI when `warn`, otherwise its host. */
  target: string;
  warn: boolean;
  areas: ConsentArea[];
  days: readonly number[];
  defaultDays: number;
  /** Every OAuth parameter, kept through the form as hidden fields. */
  fields: [string, string][];
  /** The same request in the other language. */
  langHref: string;
}

/** The language of a request: `rsg_lang` when it is tr or en, else Turkish when Accept-Language lists tr first, else English. */
export function consentLang(request: Request, param: string | null): Lang {
  if (param === 'tr' || param === 'en') return param;
  const first = (request.headers.get('Accept-Language') ?? '').split(',')[0].trim().toLowerCase();
  return first === 'tr' || first.startsWith('tr-') ? 'tr' : 'en';
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Pair = { tr: string; en: string };

const AREA_NAME: Record<string, Pair> = {
  'cms.etkinlikler': { en: 'Events, workshops and webinars', tr: 'Etkinlikler, çalıştaylar ve webinarlar' },
  'cms.yazilar': { en: 'Posts', tr: 'Yazılar' },
  'cms.ogrenme': { en: 'Learning', tr: 'Öğrenme' },
  'cms.topluluk': { en: 'Community', tr: 'Topluluk' },
  'cms.sayfalar': { en: 'Pages', tr: 'Sayfalar' },
  social: { en: 'Social media', tr: 'Sosyal medya' },
};

const T = {
  title: { en: 'Connect an app to RSG-Türkiye', tr: 'Bir uygulamayı RSG-Türkiye\'ye bağla' },
  lead: { en: 'wants to act on this site in your name.', tr: 'bu sitede senin adına işlem yapmak istiyor.' },
  asCalled: { en: 'as the app calls itself', tr: 'uygulamanın kendini adlandırışı' },
  address: { en: 'App address', tr: 'Uygulama adresi' },
  goesTo: { en: 'After you choose, you are sent to', tr: 'Seçimden sonra şuraya yönlendirilirsin' },
  warn: {
    en: 'This address is on your own device, not a website. Any program on a device can claim it. Continue only if you started this connection yourself, from an app you trust.',
    tr: 'Bu adres bir web sitesi değil, kendi cihazında bir adres. Cihazdaki herhangi bir program bu adresi sahiplenebilir. Yalnızca bu bağlantıyı kendin, güvendiğin bir uygulamadan başlattıysan devam et.',
  },
  areas: { en: 'What it may work on', tr: 'Hangi alanlarda çalışabilir' },
  areasHint: { en: 'Only areas your own roles allow are listed.', tr: 'Yalnızca kendi rollerinin izin verdiği alanlar listelenir.' },
  levelRead: { en: 'Read', tr: 'Okuma' },
  levelDraft: { en: 'Read and write drafts', tr: 'Okuma ve taslak yazma' },
  level: { en: 'Level for', tr: 'Düzey:' },
  fixed: {
    en: 'It can read and write drafts in your name. It can never approve, publish, schedule or send.',
    tr: 'Adına taslak okuyabilir ve yazabilir. Onaylayamaz, yayımlayamaz, zamanlayamaz ve gönderemez.',
  },
  life: { en: 'How long the connection lasts', tr: 'Bağlantı ne kadar sürsün' },
  days: { en: 'days', tr: 'gün' },
  allow: { en: 'Allow', tr: 'İzin ver' },
  deny: { en: 'Deny', tr: 'Reddet' },
  noAreas: {
    en: 'Your roles do not include an area an app can work on, so there is nothing to allow.',
    tr: 'Rollerin, bir uygulamanın çalışabileceği bir alan içermiyor; izin verilecek bir şey yok.',
  },
  full: {
    en: 'You already have the most connections allowed. Disconnect one in the panel, then try again.',
    tr: 'İzin verilen en çok bağlantıya zaten sahipsin. Panelden birini kaldır, sonra tekrar dene.',
  },
  panel: { en: 'Open the panel', tr: 'Paneli aç' },
  revoke: { en: 'You can disconnect it at any time in the panel.', tr: 'Bağlantıyı istediğin zaman panelden kaldırabilirsin.' },
  otherLang: { en: 'Türkçe', tr: 'English' },
  errorTitle: { en: 'This request cannot be used', tr: 'Bu istek kullanılamıyor' },
  back: { en: 'Close this page and start again from the app.', tr: 'Bu sayfayı kapat ve uygulamadan yeniden başla.' },
} satisfies Record<string, Pair>;

const ERRORS: Record<ErrorKey, Pair> = {
  signin: { en: 'Sign in first, then start again from the app.', tr: 'Önce giriş yap, sonra uygulamadan yeniden başla.' },
  client: {
    en: 'The app is not known here, or the address it asked to return to is not one it registered.',
    tr: 'Uygulama burada tanınmıyor ya da dönmek istediği adres kayıtlı adreslerinden biri değil.',
  },
  long: { en: 'The request is too long.', tr: 'İstek çok uzun.' },
  request: { en: 'The request was not valid. Start again from the app.', tr: 'İstek geçerli değildi. Uygulamadan yeniden başla.' },
  area: { en: 'Choose at least one area you hold, then allow again.', tr: 'Sahip olduğun alanlardan en az birini seç, sonra yeniden izin ver.' },
  days: { en: 'Choose how long the connection lasts.', tr: 'Bağlantının ne kadar süreceğini seç.' },
  codes: {
    en: 'Too many pending sign-ins. Wait two minutes and start again from the app.',
    tr: 'Bekleyen çok fazla giriş var. İki dakika bekle, sonra uygulamadan yeniden başla.',
  },
  full: { en: 'You already have the most connections allowed. Disconnect one in the panel, then try again.', tr: 'İzin verilen en çok bağlantıya zaten sahipsin. Panelden birini kaldır, sonra tekrar dene.' },
  none: { en: 'Nothing was chosen.', tr: 'Hiçbir şey seçilmedi.' },
};

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#F7F7F6;color:#333;font:16px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:0 auto;padding:1rem}
.card{background:#fff;border:1px solid #E5E4DF;border-radius:1rem;padding:1.5rem 1.25rem}
h1{margin:0 0 .75rem;font-size:1.375rem;line-height:1.3;color:#1a2744}
h2{margin:1.5rem 0 .25rem;font-size:1rem;color:#1a2744}
p{margin:.5rem 0}
.name{font-weight:700;color:#1a2744;overflow-wrap:anywhere}
.small{font-size:.875rem;color:#4b5563}
.uri{overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:.875rem;background:#EEF1F8;border:1px solid #E5E4DF;border-radius:.5rem;padding:.5rem .625rem}
.warn{background:#FDEAEA;border:1px solid #C0232A;border-radius:.5rem;padding:.625rem .75rem;margin:.75rem 0;color:#1a2744}
.area{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.25rem 0;border-top:1px solid #E5E4DF}
.area label{display:flex;align-items:center;gap:.625rem;min-height:44px;flex:1 1 12rem}
input[type=checkbox]{width:1.25rem;height:1.25rem;accent-color:#1a2744;flex:none}
select{min-height:44px;font:inherit;color:#1a2744;background:#fff;border:1px solid #9ca3af;border-radius:.5rem;padding:0 .5rem;max-width:100%}
.fixed{margin-top:1.25rem;padding:.75rem;background:#EEF1F8;border-radius:.5rem;color:#1a2744}
.row{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.5rem}
button,.btn{min-height:44px;padding:0 1.25rem;font:inherit;font-weight:600;border-radius:.625rem;border:2px solid #1a2744;cursor:pointer;flex:1 1 8rem;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.go{background:#1a2744;color:#fff}
.no{background:#fff;color:#1a2744}
a{color:#3D5A9E}
:focus-visible{outline:2px solid #3D5A9E;outline-offset:2px}
.foot{text-align:center;margin:1rem 0 0;font-size:.875rem}
`;

function shell(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} | RSG-Türkiye</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

export function errorPage(lang: Lang, key: ErrorKey): string {
  return shell(lang, T.errorTitle[lang], `<div class="card">
<h1>${esc(T.errorTitle[lang])}</h1>
<p>${esc(ERRORS[key][lang])}</p>
<p class="small">${esc(T.back[lang])}</p>
</div>`);
}

export function consentPage(v: ConsentView): string {
  const l = v.lang;
  const hidden = v.fields.map(([k, val]) => `<input type="hidden" name="${esc(k)}" value="${esc(val)}">`).join('\n');
  const where = v.warn
    ? `<p class="warn">${esc(T.warn[l])}</p>\n<p>${esc(T.goesTo[l])}:</p>\n<p class="uri">${esc(v.target)}</p>`
    : `<p>${esc(T.goesTo[l])}: <span class="name">${esc(v.target)}</span></p>`;
  const who = `<p><span class="name">${esc(v.clientName)}</span> <span class="small">(${esc(T.asCalled[l])})</span> ${esc(T.lead[l])}</p>
${v.clientHost ? `<p class="small">${esc(T.address[l])}: ${esc(v.clientHost)}</p>` : ''}
${where}`;
  const deny = `<button class="no" type="submit" name="action" value="deny">${esc(T.deny[l])}</button>`;

  let main: string;
  if (v.state === 'form') {
    const areas = v.areas.map((a) => {
      const name = AREA_NAME[a.area]?.[l] ?? a.area;
      const sel = (lv: 'read' | 'draft') => (a.level === lv ? ' selected' : '');
      return `<div class="area">
<label><input type="checkbox" name="area" value="${esc(a.area)}"${a.ticked ? ' checked' : ''}> <span>${esc(name)}</span></label>
<select name="level_${esc(a.area)}" aria-label="${esc(`${T.level[l]} ${name}`)}">
<option value="read"${sel('read')}>${esc(T.levelRead[l])}</option>
<option value="draft"${sel('draft')}>${esc(T.levelDraft[l])}</option>
</select>
</div>`;
    }).join('\n');
    const days = v.days.map((d) => `<option value="${d}"${d === v.defaultDays ? ' selected' : ''}>${d} ${esc(T.days[l])}</option>`).join('\n');
    main = `${who}
<h2>${esc(T.areas[l])}</h2>
<p class="small">${esc(T.areasHint[l])}</p>
${areas}
<p class="fixed">${esc(T.fixed[l])}</p>
<h2><label for="days">${esc(T.life[l])}</label></h2>
<select id="days" name="days">
${days}
</select>
<p class="small">${esc(T.revoke[l])}</p>
<div class="row">
<button class="go" type="submit" name="action" value="allow">${esc(T.allow[l])}</button>
${deny}
</div>`;
  } else {
    const msg = v.state === 'full' ? T.full[l] : T.noAreas[l];
    const link = v.state === 'full' ? `<p><a href="/admin#anahtarlar">${esc(T.panel[l])}</a></p>` : '';
    main = `${who}
<p class="fixed">${esc(msg)}</p>
${link}
<div class="row">
${deny}
</div>`;
  }

  return shell(l, T.title[l], `<div class="card">
<h1>${esc(T.title[l])}</h1>
<form method="post" action="/oauth/authorize">
${hidden}
${main}
</form>
</div>
<p class="foot"><a href="${esc(v.langHref)}" hreflang="${l === 'tr' ? 'en' : 'tr'}">${esc(T.otherLang[l])}</a></p>`);
}
