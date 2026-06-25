/**
 * i18n.js — synchronous trilingual dictionary for the WM 2026 PWA.
 *
 * Three locales: de (default, Swiss register), en (en-GB), ptBR. No build step,
 * no async — the dictionary is baked into this module and imported like parse.js.
 *
 *   t("key", { name: "X" })   → look up + interpolate ${name} tokens (de fallback).
 *   getLang() / setLang(l)    → active locale; setLang persists + sets <html lang>.
 *   fmtKickoff(d) / fmtTimeHM(d) / fmtDateShort(d) / fmtDateWeekday(d) / fmtNumber(n)
 *                             → Intl.* in the active locale (weekday/month names
 *                               localize for free; only relative-day words are keys).
 *
 * Team + round DISPLAY names are NOT here — teams come language-aware from the
 * Worker (flags via flagForId in parse.js); round labels come from the Worker's
 * localized `round` string + roundKey. Only the round PLACEHOLDER labels (empty
 * bracket slots) use spiele.round.* keys here.
 *
 * Missing en/ptBR falls back to de, then to the key itself (visible + console.warn,
 * never throws) so a gap renders German rather than crashing.
 */

"use strict";

export const LOCALES = ["de", "en", "ptBR"];
export const DEFAULT_LOCALE = "de";

// Internal locale key → BCP-47 tag for Intl.* + <html lang>.
const BCP47 = { de: "de-CH", en: "en-GB", ptBR: "pt-BR" };

let _lang = resolveInitialLang();

export function getLang() { return _lang; }
export function getBcp47() { return BCP47[_lang] || "de-CH"; }

// Internal locale key → the API ?lang= code the Worker's normLang() expects.
const API_LANG = { de: "de", en: "en", ptBR: "pt-BR" };
/** The ?lang= value for /api/wm/* requests in the active language. */
export function apiLang() { return API_LANG[_lang] || "de"; }

export function setLang(next) {
  if (!LOCALES.includes(next)) return;
  try { localStorage.setItem("wm.lang", next); } catch (_e) {}
  _lang = next;
  try { document.documentElement.lang = next === "ptBR" ? "pt-BR" : next; } catch (_e) {}
}

function resolveInitialLang() {
  try {
    const saved = localStorage.getItem("wm.lang");
    if (saved && LOCALES.includes(saved)) return saved;
  } catch (_e) {}
  const navs = (typeof navigator !== "undefined" && navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [(typeof navigator !== "undefined" && navigator.language) || ""];
  for (const raw of navs) {
    const l = String(raw).toLowerCase();
    if (l.startsWith("pt")) return "ptBR"; // pt → Brazilian (the only pt we ship)
    if (l.startsWith("en")) return "en";
    if (l.startsWith("de")) return "de";
  }
  return DEFAULT_LOCALE;
}

const TOKEN = /\$\{([^}]+)\}/g;

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(TOKEN, (m, k) => (params[k] != null ? String(params[k]) : m));
}

/** Look up a key in the active language (de fallback, then the key itself). */
export function t(key, params) {
  const entry = DICT[key];
  if (!entry) {
    if (typeof console !== "undefined") console.warn("[i18n] missing key:", key);
    return key;
  }
  const raw = entry[_lang] != null ? entry[_lang] : entry.de;
  return raw == null ? key : interpolate(raw, params);
}

// Cached Intl formatters keyed by a signature so we don't rebuild per call.
const _fmtCache = new Map();
function fmt(kind, opts) {
  const tag = getBcp47();
  const sig = tag + "|" + kind + "|" + JSON.stringify(opts);
  let f = _fmtCache.get(sig);
  if (!f) {
    f = kind === "num" ? new Intl.NumberFormat(tag, opts) : new Intl.DateTimeFormat(tag, opts);
    _fmtCache.set(sig, f);
  }
  return f;
}

export function fmtNumber(n, opts) { return fmt("num", opts).format(n); }
export function fmtDateShort(d) { return fmt("date", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d); }
export function fmtDateWeekday(d) { return fmt("date", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(d); }
export function fmtTimeHM(d) { return fmt("time", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(d); }
export function fmtKickoff(d) { return fmt("kick", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(d); }

const DICT = {

  // -- common --
  "common.appTitle": { de: "WM 2026", en: "World Cup 2026", ptBR: "Copa 2026" },
  "common.assists": { de: "Vorlagen", en: "Assists", ptBR: "Assistências" },
  "common.back": { de: "Zurück", en: "Back", ptBR: "Voltar" },
  "common.close": { de: "Schliessen", en: "Close", ptBR: "Fechar" },
  "common.emptyDash": { de: "—", en: "—", ptBR: "—" },
  "common.goals": { de: "Tore", en: "Goals", ptBR: "Gols" },
  "common.jumpToMatch": { de: "Zu einem Spiel springen", en: "Jump to a match", ptBR: "Ir para um jogo" },
  "common.loadError": { de: "Konnte nicht geladen werden.", en: "Couldn't load.", ptBR: "Não foi possível carregar." },
  "common.loadErrorRetry": { de: "Bitte nochmals versuchen.", en: "Please try again.", ptBR: "Tente novamente." },
  "common.loading": { de: "Wird geladen…", en: "Loading…", ptBR: "Carregando…" },
  "common.matches": { de: "Spiele", en: "Matches", ptBR: "Jogos" },
  "common.metaDescription": { de: "FIFA WM 2026 — Highlights & Spielplan.", en: "FIFA World Cup 2026 — highlights & fixtures.", ptBR: "Copa do Mundo FIFA 2026 — melhores momentos e tabela de jogos." },
  "common.noData": { de: "Noch keine Daten.", en: "No data yet.", ptBR: "Ainda sem dados." },
  "common.rank": { de: "Rang", en: "Rank", ptBR: "Posição" },
  "common.round.final": { de: "Finale", en: "Final", ptBR: "Final" },
  "common.round.quarterfinal": { de: "Viertelfinale", en: "Quarter-final", ptBR: "Quartas de final" },
  "common.round.semifinal": { de: "Halbfinale", en: "Semi-final", ptBR: "Semifinal" },
  "common.round.thirdPlace": { de: "Spiel um Platz 3", en: "Third-place play-off", ptBR: "Disputa de 3º lugar" },
  "common.searchLabel": { de: "Team oder Gruppe suchen", en: "Search team or group", ptBR: "Buscar seleção ou grupo" },
  "common.searchPlaceholder": { de: "Team oder Gruppe…", en: "Team or group…", ptBR: "Seleção ou grupo…" },
  "common.today": { de: "Heute", en: "Today", ptBR: "Hoje" },
  "common.tomorrow": { de: "Morgen", en: "Tomorrow", ptBR: "Amanhã" },
  "common.unknown": { de: "Unbekannt", en: "Unknown", ptBR: "Desconhecido" },
  "common.viewSwitcherLabel": { de: "WM Ansicht", en: "World Cup view", ptBR: "Visualização da Copa" },
  "common.yesterday": { de: "Gestern", en: "Yesterday", ptBR: "Ontem" },

  // -- feed --
  "feed.drawer.dayFallback": { de: "—", en: "—", ptBR: "—" },
  "feed.drawer.infoOpen.ariaLabel": { de: "Spielinfo öffnen", en: "Open match info", ptBR: "Abrir informações da partida" },
  "feed.drawer.infoOpen.title": { de: "Spielinfo", en: "Match info", ptBR: "Informações da partida" },
  "feed.drawer.loading": { de: "Spiele werden geladen…", en: "Loading matches…", ptBR: "Carregando partidas…" },
  "feed.drawer.loadingMore": { de: "Weitere Spiele werden geladen…", en: "Loading more matches…", ptBR: "Carregando mais partidas…" },
  "feed.drawer.noGames": { de: "Noch keine Spiele.", en: "No matches yet.", ptBR: "Nenhuma partida ainda." },
  "feed.drawer.noMatch": { de: "Kein Spiel gefunden.", en: "No match found.", ptBR: "Nenhuma partida encontrada." },
  "feed.empty.noClips": { de: "Noch keine Clips.<br>Schau später nochmal vorbei.", en: "No clips yet.<br>Check back later.", ptBR: "Nenhum clipe ainda.<br>Volte mais tarde." },
  "feed.error.offline": { de: "Keine Verbindung.<br>Highlights konnten nicht geladen werden.", en: "No connection.<br>Highlights couldn't be loaded.", ptBR: "Sem conexão.<br>Não foi possível carregar os melhores momentos." },
  "feed.error.playback": { de: "Konnte nicht geladen werden.", en: "Couldn't be loaded.", ptBR: "Não foi possível carregar." },
  "feed.infoChip": { de: "→ Spielinfo", en: "→ Match info", ptBR: "→ Informações da partida" },
  "feed.kind.feature": { de: "Magazin", en: "Feature", ptBR: "Reportagem" },
  "feed.kind.goal": { de: "Szene", en: "Clip", ptBR: "Lance" },
  "feed.kind.match": { de: "Spielzusammenfassung", en: "Match summary", ptBR: "Resumo da partida" },
  "feed.kind.summary": { de: "Zusammenfassung", en: "Summary", ptBR: "Resumo" },
  "feed.loading": { de: "Highlights werden geladen…", en: "Loading highlights…", ptBR: "Carregando melhores momentos…" },
  "feed.marker.goal": { de: "Tor", en: "Goal", ptBR: "Gol" },
  "feed.marker.jumpTo": { de: "Springe zu ${label}", en: "Jump to ${label}", ptBR: "Ir para ${label}" },
  "feed.play.ariaLabel": { de: "Abspielen", en: "Play", ptBR: "Reproduzir" },
  "feed.score.finalTag": { de: "Endstand", en: "Full time", ptBR: "Placar final" },
  "feed.score.live": { de: "● LIVE ${minute}", en: "● LIVE ${minute}", ptBR: "● AO VIVO ${minute}" },
  "feed.scrollHint": { de: "Mehr", en: "More", ptBR: "Mais" },
  "feed.tab": { de: "Highlights", en: "Highlights", ptBR: "Melhores momentos" },

  // -- halloffame --
  "halloffame.footer.stand": { de: "Stand ${stamp} · ${seasonsIngested} WM-Turniere · Quelle: FIFA", en: "As of ${stamp} · ${seasonsIngested} World Cups · Source: FIFA", ptBR: "Atualizado em ${stamp} · ${seasonsIngested} Copas do Mundo · Fonte: FIFA" },
  "halloffame.label.goals": { de: "Tore", en: "Goals", ptBR: "Gols" },
  "halloffame.label.tournamentPlural": { de: "WMs", en: "World Cups", ptBR: "Copas" },
  "halloffame.label.tournamentSingular": { de: "WM", en: "World Cup", ptBR: "Copa" },
  "halloffame.sub.tournamentsPlural": { de: "${tournaments} WM-Turniere", en: "${tournaments} World Cups", ptBR: "${tournaments} Copas do Mundo" },
  "halloffame.sub.tournamentsSingular": { de: "${tournaments} WM", en: "${tournaments} World Cup", ptBR: "${tournaments} Copa do Mundo" },
  "halloffame.tab.allTimeGoals": { de: "Tore aller Zeiten", en: "All-Time Goals", ptBR: "Gols de Todos os Tempos" },
  "halloffame.tab.bestSingleWM": { de: "Tore in einem WM", en: "Goals in One World Cup", ptBR: "Gols em uma Copa" },
  "halloffame.tab.mostTourneys": { de: "Meiste Teilnahmen", en: "Most Appearances", ptBR: "Mais Participações" },

  // -- mehr --
  "mehr.bracket.finalColumnHeading": { de: "🏆 Finale", en: "🏆 Final", ptBR: "🏆 Final" },
  "mehr.bracket.hint": { de: "Finalrunde — <b>Viertelfinale bis Finale</b>. Sieger fett, dunkle Linie folgt dem Weg ins Finale.<br>Sechzehntel- &amp; Achtelfinale unter Tab «Spiele».", en: "Knockout stage — <b>Quarter-finals to the Final</b>. Winners in bold, the dark line traces the path to the Final.<br>Round of 32 &amp; Round of 16 under the «Matches» tab.", ptBR: "Fase final — <b>Quartas de final até a Final</b>. Vencedores em negrito, a linha escura mostra o caminho até a Final.<br>Trinta e duas avos &amp; Oitavas de final na aba «Jogos»." },
  "mehr.bracket.label": { de: "K.-o.-Baum", en: "Knockout Bracket", ptBR: "Chave Mata-Mata" },
  "mehr.bracket.loading": { de: "Lade Finalrunde…", en: "Loading knockout stage…", ptBR: "Carregando fase final…" },
  "mehr.bracket.slotPlaceholder": { de: "${m._placeholder} ${i + 1}", en: "${m._placeholder} ${i + 1}", ptBR: "${m._placeholder} ${i + 1}" },
  "mehr.bracket.sub": { de: "Viertelfinal bis Finale · der Weg zum Pokal", en: "Quarter-finals to the Final · the road to the trophy", ptBR: "Quartas de final até a Final · o caminho até a taça" },
  "mehr.bracket.tbd": { de: "TBD", en: "TBD", ptBR: "A definir" },
  "mehr.bracket.title": { de: "K.-o.-Baum", en: "Knockout Bracket", ptBR: "Chave Mata-Mata" },
  "mehr.bracket.worldChampion": { de: "Weltmeister", en: "World Champion", ptBR: "Campeão Mundial" },
  "mehr.halloffame.label": { de: "Ruhmeshalle", en: "Hall of Fame", ptBR: "Hall da Fama" },
  "mehr.halloffame.sub": { de: "Top-Torschützen aller Zeiten, beste Einzel-WM, meiste Teilnahmen", en: "All-time top scorers, best single World Cup, most appearances", ptBR: "Maiores artilheiros de todos os tempos, melhor Copa individual, mais participações" },
  "mehr.halloffame.title": { de: "Ruhmeshalle", en: "Hall of Fame", ptBR: "Hall da Fama" },
  "mehr.kader.backToOverview": { de: "‹ Zurück zur Übersicht", en: "‹ Back to overview", ptBR: "‹ Voltar à visão geral" },
  "mehr.kader.loading": { de: "Kader werden geladen…", en: "Loading squads…", ptBR: "Carregando elencos…" },
  "mehr.kader.noPlayersInSquad": { de: "Keine Spieler in diesem Kader.", en: "No players in this squad.", ptBR: "Nenhum jogador neste elenco." },
  "mehr.kader.noTeamFound": { de: "Kein Team gefunden.", en: "No team found.", ptBR: "Nenhuma seleção encontrada." },
  "mehr.kader.notAvailableSub": { de: "Wird vor dem ersten Spiel veröffentlicht.", en: "Published before the first match.", ptBR: "Divulgado antes do primeiro jogo." },
  "mehr.kader.notAvailableTitle": { de: "Kader noch nicht verfügbar", en: "Squad not available yet", ptBR: "Elenco ainda não disponível" },
  "mehr.kader.playerCount": { de: "${count} Spieler", en: "${count} players", ptBR: "${count} jogadores" },
  "mehr.kader.position.abwehr": { de: "Abwehr", en: "Defence", ptBR: "Zaga" },
  "mehr.kader.position.angriff": { de: "Angriff", en: "Attack", ptBR: "Ataque" },
  "mehr.kader.position.mittelfeld": { de: "Mittelfeld", en: "Midfield", ptBR: "Meio-campo" },
  "mehr.kader.position.tor": { de: "Tor", en: "Goalkeeper", ptBR: "Goleiro" },
  "mehr.kader.searchPlaceholder": { de: "Team suchen…", en: "Search team…", ptBR: "Buscar seleção…" },
  "mehr.kader.teamNotFound": { de: "Team nicht gefunden.", en: "Team not found.", ptBR: "Seleção não encontrada." },
  "mehr.lineups.label": { de: "Aufstellungen", en: "Lineups", ptBR: "Escalações" },
  "mehr.lineups.sub": { de: "Formationen, Startelf, Auswechslungen", en: "Formations, starting eleven, substitutions", ptBR: "Formações, escalação titular, substituições" },
  "mehr.lineups.title": { de: "Aufstellungen", en: "Lineups", ptBR: "Escalações" },
  "mehr.section.app": { de: "App", en: "App", ptBR: "App" },
  "mehr.section.spielerMannschaften": { de: "Spieler & Mannschaften", en: "Players & Teams", ptBR: "Jogadores & Seleções" },
  "mehr.section.spielplan": { de: "Spielplan", en: "Schedule", ptBR: "Tabela de Jogos" },
  "mehr.section.statistiken": { de: "Statistiken", en: "Statistics", ptBR: "Estatísticas" },
  "mehr.settings.label": { de: "Einstellungen", en: "Settings", ptBR: "Configurações" },
  "mehr.settings.sub": { de: "Besucherkarte · Feedback · App-Version", en: "Visitor map · Feedback · App version", ptBR: "Mapa de visitantes · Feedback · Versão do app" },
  "mehr.settings.title": { de: "Einstellungen", en: "Settings", ptBR: "Configurações" },
  "mehr.soonBadge": { de: "bald", en: "soon", ptBR: "em breve" },
  "mehr.spielerkarte.age": { de: "Alter", en: "Age", ptBR: "Idade" },
  "mehr.spielerkarte.birthPlace": { de: "Geburtsort", en: "Birthplace", ptBR: "Naturalidade" },
  "mehr.spielerkarte.caps": { de: "Caps", en: "Caps", ptBR: "Jogos pela seleção" },
  "mehr.spielerkarte.enlargePhoto": { de: "Foto vergrössern", en: "Enlarge photo", ptBR: "Ampliar foto" },
  "mehr.spielerkarte.footBoth": { de: "Beidfüssig", en: "Both-footed", ptBR: "Ambidestro" },
  "mehr.spielerkarte.footLeft": { de: "Links", en: "Left", ptBR: "Esquerdo" },
  "mehr.spielerkarte.footRight": { de: "Rechts", en: "Right", ptBR: "Direito" },
  "mehr.spielerkarte.height": { de: "Grösse", en: "Height", ptBR: "Altura" },
  "mehr.spielerkarte.heightUnit": { de: "cm", en: "cm", ptBR: "cm" },
  "mehr.spielerkarte.loadError": { de: "Spielerkarte konnte nicht geladen werden.", en: "Player card could not be loaded.", ptBR: "Não foi possível carregar a ficha do jogador." },
  "mehr.spielerkarte.loading": { de: "Lade Spielerkarte…", en: "Loading player card…", ptBR: "Carregando ficha do jogador…" },
  "mehr.spielerkarte.strongFoot": { de: "Starker Fuss", en: "Strong foot", ptBR: "Pé dominante" },
  "mehr.spielerkarte.wmBilanz": { de: "WM 2026 — Bilanz", en: "World Cup 2026 — Record", ptBR: "Copa 2026 — Desempenho" },
  "mehr.squads.label": { de: "Kader", en: "Squads", ptBR: "Elencos" },
  "mehr.squads.sub": { de: "Alle 48 Teams · Tippe auf einen Spieler für die Karte", en: "All 48 teams · Tap a player for their card", ptBR: "Todas as 48 seleções · Toque num jogador para ver a ficha" },
  "mehr.squads.title": { de: "Kader", en: "Squads", ptBR: "Elencos" },
  "mehr.tab": { de: "Mehr", en: "More", ptBR: "Mais" },
  "mehr.tabellen.label": { de: "Tabellen", en: "Standings", ptBR: "Classificação" },
  "mehr.tabellen.sub": { de: "Offizielle Gruppen mit Qualifikationsstatus", en: "Official groups with qualification status", ptBR: "Grupos oficiais com status de classificação" },
  "mehr.tabellen.title": { de: "Tabellen", en: "Standings", ptBR: "Classificação" },
  "mehr.topscorers.label": { de: "Torjägerliste", en: "Top Scorers", ptBR: "Artilharia" },
  "mehr.topscorers.sub": { de: "Goldener Schuh · Tore, Vorlagen, Spiele", en: "Golden Boot · Goals, assists, matches", ptBR: "Chuteira de Ouro · Gols, assistências, jogos" },
  "mehr.topscorers.title": { de: "Torjägerliste", en: "Top Scorers", ptBR: "Artilharia" },

  // -- settings --
  "settings.about.appVersion": { de: "App-Version", en: "App version", ptBR: "Versão do app" },
  "settings.about.feedback": { de: "✉ Feedback senden", en: "✉ Send feedback", ptBR: "✉ Enviar feedback" },
  "settings.about.sourceCode": { de: "↗ Quellcode auf GitHub", en: "↗ Source code on GitHub", ptBR: "↗ Código-fonte no GitHub" },
  "settings.countries.empty": { de: "Noch keine Daten — sobald jemand die App öffnet, taucht der Eintrag hier auf.", en: "No data yet — once someone opens the app, the entry shows up here.", ptBR: "Ainda sem dados — assim que alguém abrir o app, o registro aparece aqui." },
  "settings.event.clipPlayStart": { de: "Clip gestartet", en: "Clip started", ptBR: "Clipe iniciado" },
  "settings.event.clipPlayStop": { de: "Clip beendet", en: "Clip ended", ptBR: "Clipe encerrado" },
  "settings.event.drawerOpen": { de: "Spielmenü geöffnet", en: "Match menu opened", ptBR: "Menu da partida aberto" },
  "settings.event.highlightsLinkOpen": { de: "Highlights-Link geöffnet", en: "Highlights link opened", ptBR: "Link dos melhores momentos aberto" },
  "settings.event.mehrSubOpen": { de: "Mehr-Ansicht geöffnet", en: "More view opened", ptBR: "Tela Mais aberta" },
  "settings.event.pageLoad": { de: "Seite geladen", en: "Page loaded", ptBR: "Página carregada" },
  "settings.event.spielerkarteOpen": { de: "Spielerkarte geöffnet", en: "Player card opened", ptBR: "Cartão do jogador aberto" },
  "settings.event.spielinfoOpen": { de: "Spielinfo geöffnet", en: "Match info opened", ptBR: "Informações da partida abertas" },
  "settings.event.tabSwitch": { de: "Tab gewechselt", en: "Tab switched", ptBR: "Aba alterada" },
  "settings.events.empty": { de: "Noch keine Aktivitäten.", en: "No activity yet.", ptBR: "Ainda sem atividades." },
  "settings.install.btn.installNow": { de: "Jetzt installieren", en: "Install now", ptBR: "Instalar agora" },
  "settings.install.note": { de: "Auf iPhone: Browser-Menü ⬆ → «Zum Home-Bildschirm». Auf Android: Browser-Menü → «App installieren».", en: "On iPhone: browser menu ⬆ → «Add to Home Screen». On Android: browser menu → «Install app».", ptBR: "No iPhone: menu do navegador ⬆ → «Adicionar à Tela de Início». No Android: menu do navegador → «Instalar app»." },
  "settings.install.showInstructions": { de: "Anleitung anzeigen", en: "Show instructions", ptBR: "Mostrar instruções" },
  "settings.install.status.installable": { de: "Installation verfügbar", en: "Installation available", ptBR: "Instalação disponível" },
  "settings.install.status.installed": { de: "✓ App ist installiert", en: "✓ App is installed", ptBR: "✓ App instalado" },
  "settings.install.status.iosInstructions": { de: "iPhone-Anleitung verfügbar", en: "iPhone instructions available", ptBR: "Instruções para iPhone disponíveis" },
  "settings.install.status.unsupported": { de: "Im Browser ohne Installations-Schnittstelle geöffnet", en: "Opened in a browser without an install option", ptBR: "Aberto em um navegador sem opção de instalação" },
  "settings.installBanner.dialogLabel": { de: "App installieren", en: "Install app", ptBR: "Instalar app" },
  "settings.installBanner.generic.body": { de: "Im Browser-Menü: «App installieren» / «Zum Dock hinzufügen».", en: "In the browser menu: «Install app» / «Add to Dock».", ptBR: "No menu do navegador: «Instalar app» / «Adicionar ao Dock»." },
  "settings.installBanner.generic.title": { de: "App installieren", en: "Install app", ptBR: "Instalar app" },
  "settings.installBanner.installButton": { de: "Installieren", en: "Install", ptBR: "Instalar" },
  "settings.installBanner.ios.body": { de: "Tippe unten auf <b>Teilen</b> ${shareIcon} → <b>Zum Home-Bildschirm</b>.", en: "Tap <b>Share</b> ${shareIcon} below → <b>Add to Home Screen</b>.", ptBR: "Toque em <b>Compartilhar</b> ${shareIcon} abaixo → <b>Adicionar à Tela de Início</b>." },
  "settings.installBanner.ios.title": { de: "Auf den Startbildschirm", en: "Add to Home Screen", ptBR: "Adicionar à Tela de Início" },
  "settings.installBanner.native.body": { de: "Eigenes Icon auf dem Startbildschirm — startet schneller, läuft auch offline.", en: "Your own icon on the home screen — starts faster and works offline too.", ptBR: "Um ícone próprio na tela de início — abre mais rápido e funciona offline também." },
  "settings.installBanner.native.title": { de: "WM 2026 installieren", en: "Install World Cup 2026", ptBR: "Instalar Copa 2026" },
  "settings.map.loadError": { de: "Karte konnte nicht geladen werden.", en: "Map could not be loaded.", ptBR: "Não foi possível carregar o mapa." },
  "settings.ptrHint.label": { de: "Ziehen + halten zum Aktualisieren", en: "Pull and hold to refresh", ptBR: "Puxe e segure para atualizar" },
  "settings.section.about": { de: "Über", en: "About", ptBR: "Sobre" },
  "settings.section.language": { de: "Sprache", en: "Language", ptBR: "Idioma" },
  "settings.language.ariaLabel": { de: "Sprache wählen", en: "Choose language", ptBR: "Escolher idioma" },
  "settings.section.activities": { de: "Aktivitäten", en: "Activity", ptBR: "Atividades" },
  "settings.section.installHome": { de: "App auf Startbildschirm", en: "Add app to home screen", ptBR: "App na tela de início" },
  "settings.section.topCountries": { de: "Top-Länder", en: "Top countries", ptBR: "Principais países" },
  "settings.section.visitorMap": { de: "Besucherkarte (30 Tage)", en: "Visitor map (30 days)", ptBR: "Mapa de visitantes (30 dias)" },
  "settings.totals.countries": { de: "Länder", en: "Countries", ptBR: "Países" },
  "settings.totals.events": { de: "Ereignisse", en: "Events", ptBR: "Eventos" },
  "settings.totals.sessions": { de: "Sitzungen", en: "Sessions", ptBR: "Sessões" },

  // -- spiele --
  "spiele.allMatches": { de: "Alle Spiele", en: "All Matches", ptBR: "Todos os jogos" },
  "spiele.aufstellungen.benchHeading": { de: "Ersatzbank", en: "Bench", ptBR: "Banco de reservas" },
  "spiele.aufstellungen.coach": { de: "Trainer: ${coachName}", en: "Coach: ${coachName}", ptBR: "Técnico: ${coachName}" },
  "spiele.aufstellungen.legendRed": { de: "Rot", en: "Red", ptBR: "Vermelho" },
  "spiele.aufstellungen.legendYellow": { de: "Gelb", en: "Yellow", ptBR: "Amarelo" },
  "spiele.aufstellungen.lineupEmpty": { de: "Keine Aufstellung verfügbar.", en: "No lineup available.", ptBR: "Escalação não disponível." },
  "spiele.aufstellungen.lineupLoading": { de: "Aufstellung wird geladen…", en: "Loading lineup…", ptBR: "Carregando escalação…" },
  "spiele.aufstellungen.matchesLoading": { de: "Spiele werden geladen…", en: "Loading matches…", ptBR: "Carregando jogos…" },
  "spiele.aufstellungen.noMatchesYet": { de: "Aufstellungen erscheinen ca. 60 Minuten vor Anstoss.", en: "Lineups appear about 60 minutes before kick-off.", ptBR: "As escalações aparecem cerca de 60 minutos antes do apito inicial." },
  "spiele.aufstellungen.pickPrompt": { de: "Spiel wählen", en: "Pick a match", ptBR: "Escolher jogo" },
  "spiele.aufstellungen.pickerEmpty": { de: "Keine Spiele mit Aufstellungen verfügbar.", en: "No matches with lineups available.", ptBR: "Nenhum jogo com escalação disponível." },
  "spiele.aufstellungen.pickerSwitch": { de: "Wechseln ▾", en: "Switch ▾", ptBR: "Trocar ▾" },
  "spiele.aufstellungen.pitchAria": { de: "Spielfeld", en: "Pitch", ptBR: "Campo" },
  "spiele.aufstellungen.posDef": { de: "AB", en: "DF", ptBR: "ZAG" },
  "spiele.aufstellungen.posFwd": { de: "ST", en: "FW", ptBR: "ATA" },
  "spiele.aufstellungen.posGk": { de: "TW", en: "GK", ptBR: "GOL" },
  "spiele.aufstellungen.posMid": { de: "MF", en: "MF", ptBR: "MEI" },
  "spiele.aufstellungen.sideAway": { de: "Auswärts", en: "Away", ptBR: "Visitante" },
  "spiele.aufstellungen.sideHome": { de: "Heim", en: "Home", ptBR: "Mandante" },
  "spiele.emptyState": { de: "Spielplan momentan nicht verfügbar.", en: "Schedule currently unavailable.", ptBR: "Tabela de jogos indisponível no momento." },
  "spiele.goal.ownGoal": { de: " (ET)", en: " (OG)", ptBR: " (GC)" },
  "spiele.goal.penalty": { de: " (FE)", en: " (P)", ptBR: " (P)" },
  "spiele.groupTitle": { de: "Gruppe ${g}", en: "Group ${g}", ptBR: "Grupo ${g}" },
  "spiele.liveBadge": { de: "● LIVE ${minute}'", en: "● LIVE ${minute}'", ptBR: "● AO VIVO ${minute}'" },
  "spiele.loading": { de: "Spielplan wird geladen…", en: "Loading schedule…", ptBR: "Carregando tabela de jogos…" },
  "spiele.round.final": { de: "Final", en: "Final", ptBR: "Final" },
  "spiele.round.qf": { de: "Viertelfinale", en: "Quarter-finals", ptBR: "Quartas de final" },
  "spiele.round.r16": { de: "Achtelfinale", en: "Round of 16", ptBR: "Oitavas de final" },
  "spiele.round.r32": { de: "Sechzehntelfinale", en: "Round of 32", ptBR: "Dezesseis avos de final" },
  "spiele.round.sf": { de: "Halbfinale", en: "Semi-finals", ptBR: "Semifinais" },
  "spiele.round.thirdPlace": { de: "Spiel um Platz 3", en: "Third-place play-off", ptBR: "Disputa pelo terceiro lugar" },
  "spiele.round.vorrunde": { de: "Vorrunde", en: "Group Stage", ptBR: "Fase de grupos" },
  "spiele.section.knockout": { de: "K.-o.-Runde", en: "Knockout Stage", ptBR: "Fase eliminatória" },
  "spiele.section.r16": { de: "Achtelfinale", en: "Round of 16", ptBR: "Oitavas de final" },
  "spiele.section.r32": { de: "Sechzehntelfinale", en: "Round of 32", ptBR: "Dezesseis avos de final" },
  "spiele.section.vorrunde": { de: "Vorrunde", en: "Group Stage", ptBR: "Fase de grupos" },
  "spiele.standings.goalDiff": { de: "TD", en: "GD", ptBR: "SG" },
  "spiele.standings.played": { de: "Sp", en: "P", ptBR: "J" },
  "spiele.standings.points": { de: "Pkt", en: "Pts", ptBR: "Pts" },
  "spiele.standings.team": { de: "Team", en: "Team", ptBR: "Time" },
  "spiele.tab": { de: "Spiele", en: "Matches", ptBR: "Jogos" },
  "spiele.watchHighlights": { de: "▶ Highlights ansehen", en: "▶ Watch highlights", ptBR: "▶ Ver melhores momentos" },

  // -- tabellen --
  "tabellen.badge.eliminated": { de: "Ausgeschieden", en: "Eliminated", ptBR: "Eliminado" },
  "tabellen.badge.qualified": { de: "Qualifiziert", en: "Qualified", ptBR: "Classificado" },
  "tabellen.col.drawn": { de: "U", en: "D", ptBR: "E" },
  "tabellen.col.goalDiff": { de: "TD", en: "GD", ptBR: "SG" },
  "tabellen.col.goals": { de: "Tore", en: "Goals", ptBR: "Gols" },
  "tabellen.col.lost": { de: "N", en: "L", ptBR: "D" },
  "tabellen.col.won": { de: "S", en: "W", ptBR: "V" },
  "tabellen.empty.startHint": { de: "Spielbeginn am 18.06.2026", en: "Kick-off on 18.06.2026", ptBR: "Início em 18.06.2026" },
  "tabellen.empty.title": { de: "Tabellen noch nicht verfügbar", en: "Standings not available yet", ptBR: "Classificação ainda indisponível" },
  "tabellen.group.label": { de: "Gruppe ${g}", en: "Group ${g}", ptBR: "Grupo ${g}" },
  "tabellen.header.played": { de: "Sp", en: "P", ptBR: "J" },
  "tabellen.header.points": { de: "Pkt", en: "Pts", ptBR: "Pts" },
  "tabellen.header.team": { de: "Team", en: "Team", ptBR: "Seleção" },
  "tabellen.legend.eliminated": { de: "ausgeschieden", en: "eliminated", ptBR: "eliminado" },
  "tabellen.legend.qualified": { de: "qualifiziert", en: "qualified", ptBR: "classificado" },
  "tabellen.section.groupStage": { de: "Vorrunde", en: "Group Stage", ptBR: "Fase de grupos" },
  "tabellen.toggle.details": { de: "Details ▾", en: "Details ▾", ptBR: "Detalhes ▾" },
  "tabellen.toggle.less": { de: "Weniger ▴", en: "Less ▴", ptBR: "Menos ▴" },

  // -- topscorers --
  "topscorers.emptySubtitle": { de: "Spielbeginn am 18.06.2026", en: "Kick-off on 18.06.2026", ptBR: "Início em 18.06.2026" },
  "topscorers.emptyTitle": { de: "Noch keine Tore", en: "No goals yet", ptBR: "Nenhum gol ainda" },
  "topscorers.modeCountries": { de: "Länder", en: "Countries", ptBR: "Seleções" },
  "topscorers.modePlayers": { de: "Spieler", en: "Players", ptBR: "Jogadores" },
  "topscorers.playerCountOne": { de: "1 Spieler", en: "1 player", ptBR: "1 jogador" },
  "topscorers.playerCountOther": { de: "${c.players} Spieler", en: "${c.players} players", ptBR: "${c.players} jogadores" },
  "topscorers.scopeGroupStage": { de: "Vorrunde", en: "Group Stage", ptBR: "Fase de grupos" },
  "topscorers.scopeOverall": { de: "Gesamt", en: "Overall", ptBR: "Geral" },
  "topscorers.statAssists": { de: "${c.assists} V", en: "${c.assists} A", ptBR: "${c.assists} A" },
  "topscorers.statAssistsMatches": { de: "${s.assists} V · ${s.matches} Sp", en: "${s.assists} A · ${s.matches} P", ptBR: "${s.assists} A · ${s.matches} J" },
};
