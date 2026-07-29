import { rankChunks } from './search-core.js';

export const CONTRACT_CHECKS = [
  {
    id: 'duration',
    title: 'Czas trwania i przedłużenie',
    question: 'Jaki jest czas trwania umowy, kiedy się kończy i czy przedłuża się automatycznie?',
    why: 'Automatyczne przedłużenie może związać Cię umową na kolejny okres.',
    severity: 'high',
    signals: /automatyczn|przedłuż|czas określony|czas nieokreślony|okres obowiązywania|kolejny okres/i
  },
  {
    id: 'termination',
    title: 'Wypowiedzenie',
    question: 'Jak można wypowiedzieć umowę, jaki jest termin wypowiedzenia i w jakiej formie trzeba to zrobić?',
    why: 'Długi termin lub szczególna forma wypowiedzenia utrudniają wyjście z umowy.',
    severity: 'high',
    signals: /wypowiedze|rozwiąza|odstąpi|okres wypowiedzenia|forma pisemna/i
  },
  {
    id: 'fees',
    title: 'Opłaty i zmiana ceny',
    question: 'Jakie opłaty ponosi klient i czy druga strona może jednostronnie zmienić cenę?',
    why: 'Poza ceną podstawową mogą występować opłaty dodatkowe lub indeksacja.',
    severity: 'high',
    signals: /opłat|wynagrodze|cennik|podwyż|zmian.*cen|indeksac|waloryzac|prowizj/i
  },
  {
    id: 'penalties',
    title: 'Kary i odsetki',
    question: 'Czy umowa przewiduje kary umowne, opłaty za wcześniejsze rozwiązanie, odsetki lub inne sankcje?',
    why: 'Sankcje mogą być nieproporcjonalne do wartości świadczenia.',
    severity: 'high',
    signals: /kara umowna|odsetk|sankcj|opłat.*rozwiąza|rekompensat|obciążon/i
  },
  {
    id: 'liability',
    title: 'Odpowiedzialność',
    question: 'Kto odpowiada za szkody i czy odpowiedzialność którejś strony jest ograniczona lub wyłączona?',
    why: 'Wyłączenie odpowiedzialności może przenieść większość ryzyka na Ciebie.',
    severity: 'medium',
    signals: /odpowiedzialno|nie odpowiada|wyłącz.*odpowiedzial|ogranicz.*odpowiedzial|szkod/i
  },
  {
    id: 'obligations',
    title: 'Twoje obowiązki i terminy',
    question: 'Jakie obowiązki, terminy, zgłoszenia i dokumenty musi zapewnić klient?',
    why: 'Niedopełnienie drobnego obowiązku może uruchomić opłatę albo odmowę świadczenia.',
    severity: 'medium',
    signals: /zobowiązan|obowiąz|termin|powinien|musi|zgłos|dostarczy/i
  },
  {
    id: 'privacy',
    title: 'Dane osobowe i zgody',
    question: 'Jakie dane osobowe są przetwarzane, komu mogą być przekazane i jakie zgody obejmuje umowa?',
    why: 'Warto odróżnić dane konieczne do wykonania umowy od zgód marketingowych.',
    severity: 'medium',
    signals: /dane osobowe|rodo|przetwarza|zgod.*marketing|administrator danych|udostępni/i
  },
  {
    id: 'disputes',
    title: 'Spory i prawo właściwe',
    question: 'Jak rozstrzygane są spory, jaki sąd jest właściwy i jakie prawo stosuje się do umowy?',
    why: 'Odległy sąd, arbitraż lub obce prawo mogą utrudnić dochodzenie roszczeń.',
    severity: 'medium',
    signals: /sąd właściwy|spory|arbitraż|prawo właściwe|jurysdykc|mediac/i
  }
];

export function evaluateContractCheck(check, chunks, queryVector = null, limit = 2) {
  const ranked = rankChunks(chunks, queryVector, check.question, limit);
  const best = ranked[0] ?? null;
  if (!best) return { check, status: 'missing', findings: [], score: 0 };
  const explicitSignal = check.signals.test(best.text);
  const score = Number(best.score ?? 0);
  const status = explicitSignal || score >= 0.32 ? 'found' : score >= 0.12 ? 'review' : 'missing';
  return { check, status, findings: ranked, score };
}

export function contractSummary(results) {
  const found = results.filter((result) => result.status === 'found').length;
  const review = results.filter((result) => result.status === 'review').length;
  const missing = results.filter((result) => result.status === 'missing').length;
  return { found, review, missing, total: results.length };
}
