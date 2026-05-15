// 성경 66권 한글 표기 → 표준 약자 매핑
// 본문 안의 "창세기 1장 1절", "창 1:1" 등을 [[창1_1]] 위키링크로 자동 변환

const BOOKS: Array<[string, string]> = [
  // 구약
  ['창세기', '창'], ['출애굽기', '출'], ['레위기', '레'],
  ['민수기', '민'], ['신명기', '신'], ['여호수아', '수'],
  ['사사기', '삿'], ['룻기', '룻'],
  ['사무엘상', '삼상'], ['사무엘하', '삼하'],
  ['열왕기상', '왕상'], ['열왕기하', '왕하'],
  ['역대상', '대상'], ['역대하', '대하'],
  ['에스라', '스'], ['느헤미야', '느'], ['에스더', '에'],
  ['욥기', '욥'], ['시편', '시'], ['잠언', '잠'],
  ['전도서', '전'], ['아가', '아'], ['이사야', '사'],
  ['예레미야애가', '애'], ['예레미야', '렘'],
  ['에스겔', '겔'], ['다니엘', '단'],
  ['호세아', '호'], ['요엘', '욜'], ['아모스', '암'],
  ['오바댜', '옵'], ['요나', '욘'], ['미가', '미'],
  ['나훔', '나'], ['하박국', '합'], ['스바냐', '습'],
  ['학개', '학'], ['스가랴', '슥'], ['말라기', '말'],
  // 신약
  ['마태복음', '마'], ['마가복음', '막'],
  ['누가복음', '눅'], ['요한복음', '요'],
  ['사도행전', '행'], ['로마서', '롬'],
  ['고린도전서', '고전'], ['고린도후서', '고후'],
  ['갈라디아서', '갈'], ['에베소서', '엡'],
  ['빌립보서', '빌'], ['골로새서', '골'],
  ['데살로니가전서', '살전'], ['데살로니가후서', '살후'],
  ['디모데전서', '딤전'], ['디모데후서', '딤후'],
  ['디도서', '딛'], ['빌레몬서', '몬'], ['히브리서', '히'],
  ['야고보서', '약'],
  ['베드로전서', '벧전'], ['베드로후서', '벧후'],
  ['요한일서', '요일'], ['요한이서', '요이'], ['요한삼서', '요삼'],
  ['유다서', '유'], ['요한계시록', '계'],
];

// 매칭 가능한 모든 입력 형태 (전체명 + 약자) → 표준 약자
const FORM_TO_ABBR = new Map<string, string>();
for (const [full, abbr] of BOOKS) {
  FORM_TO_ABBR.set(full, abbr);
  FORM_TO_ABBR.set(abbr, abbr);
}

// 긴 것 우선 매칭 (고린도전서 > 고전 > 고; 요한복음 > 요한 > 요)
const SORTED_FORMS = Array.from(FORM_TO_ABBR.keys()).sort(
  (a, b) => b.length - a.length
);
const BOOK_ALT = SORTED_FORMS.join('|');

// 패턴 A: <책> N장 V절 (범위 가능: 1-3절 또는 1~3절)
const PATTERN_A = new RegExp(
  `(?<![가-힣\\d\\[])(${BOOK_ALT})\\s*(\\d+)\\s*장\\s*(\\d+)(?:\\s*[-~]\\s*(\\d+))?\\s*절`,
  'g'
);

// 패턴 B: <책> N:V (범위 가능: 1:1-3)
const PATTERN_B = new RegExp(
  `(?<![가-힣\\d\\[])(${BOOK_ALT})\\s*(\\d+)\\s*:\\s*(\\d+)(?:\\s*[-~]\\s*(\\d+))?`,
  'g'
);

function expandRange(
  book: string,
  chap: number,
  start: number,
  end: number | null
): string {
  const abbr = FORM_TO_ABBR.get(book) ?? book;
  const last = end !== null && end > start ? end : start;
  const links: string[] = [];
  for (let v = start; v <= last; v++) {
    links.push(`[[${abbr}${chap}_${v}]]`);
  }
  return links.join(' ');
}

export function convertBibleReferences(text: string): string {
  let result = text;

  result = result.replace(
    PATTERN_A,
    (_match, book: string, chap: string, sv: string, ev: string | undefined) =>
      expandRange(
        book,
        parseInt(chap, 10),
        parseInt(sv, 10),
        ev ? parseInt(ev, 10) : null
      )
  );

  result = result.replace(
    PATTERN_B,
    (_match, book: string, chap: string, sv: string, ev: string | undefined) =>
      expandRange(
        book,
        parseInt(chap, 10),
        parseInt(sv, 10),
        ev ? parseInt(ev, 10) : null
      )
  );

  return result;
}
