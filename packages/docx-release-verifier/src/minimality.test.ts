import { describe, expect } from 'vitest';
import { itAllure } from '../../docx-core/src/testing/allure-test.js';
import { emittedRedlineMinimality } from './minimality.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const documentXml = (body: string) => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const plain = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const del = (text: string) => `<w:del w:id="1"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const ins = (text: string) => `<w:ins w:id="2"><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:ins>`;
const paragraph = (body: string) => `<w:p>${body}</w:p>`;

function check(original: string[], revised: string[], body: string) {
  return emittedRedlineMinimality(original, revised, documentXml(body));
}

describe('independent emitted-redline minimality', () => {
  itAllure('passes a surgical replacement and fails a coarse exact replacement', () => {
    const surgical = check(['keep old tail'], ['keep new tail'], paragraph(`${plain('keep ')}${del('old')}${ins('new')}${plain(' tail')}`));
    expect(surgical).toMatchObject({ passed: true, lostTokens: 0, efficiencyPercent: 100 });

    const coarse = check(['keep old tail'], ['keep new tail'], paragraph(`${del('keep old tail')}${ins('keep new tail')}`));
    expect(coarse.passed).toBe(false);
    expect(coarse.lostTokens).toBeGreaterThan(0);
  });

  itAllure('handles repeated tokens conservatively', () => {
    const result = check(['x x x'], ['x y x'], paragraph(`${plain('x ')}${del('x')}${ins('y')}${plain(' x')}`));
    expect(result).toMatchObject({ passed: true, lostTokens: 0 });
  });

  itAllure('preserves punctuation and whitespace tokens across revision wrappers', () => {
    const punctuation = check(['Hello, world!'], ['Hello, brave world!'], paragraph(`${plain('Hello, ')}${ins('brave ')}${plain('world!')}`));
    const whitespace = check(['a  b'], ['a  c b'], paragraph(`${plain('a  ')}${ins('c ')}${plain('b')}`));
    expect(punctuation.passed).toBe(true);
    expect(whitespace.passed).toBe(true);
  });

  itAllure('does not charge ordinary Word run, tab, or proofing fragmentation as a revision', () => {
    const runAndTab = check(
      ['Hourly Rate: \t$48.86  \t \tHourly rate includes: '],
      ['Hourly Rate: \t$48.86  \t \tHourly rate includes: '],
      paragraph('<w:r><w:t xml:space="preserve">Hourly Rate: </w:t><w:tab/></w:r><w:r><w:t>$48.</w:t></w:r><w:proofErr w:type="gramStart"/><w:r><w:t xml:space="preserve">86  </w:t><w:tab/></w:r><w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve"> </w:t><w:tab/></w:r><w:r><w:t xml:space="preserve">Hourly rate includes: </w:t></w:r>'),
    );
    const splitUnderscore = check(
      ['\tCLIENT:____________________________      \tDate :__________________ '],
      ['\tCLIENT:____________________________      \tDate :__________________ '],
      paragraph('<w:r><w:tab/></w:r><w:proofErr w:type="gramStart"/><w:r><w:t>CLIENT:_</w:t></w:r><w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve">___________________________      </w:t><w:tab/></w:r><w:proofErr w:type="gramStart"/><w:r><w:t>Date :</w:t></w:r><w:proofErr w:type="gramEnd"/><w:r><w:t xml:space="preserve">__________________ </w:t></w:r>'),
    );
    expect(runAndTab).toMatchObject({ passed: true, lostTokens: 0 });
    expect(splitUnderscore).toMatchObject({ passed: true, lostTokens: 0 });
  });

  itAllure('admits true insertion and deletion without charging neighboring text', () => {
    const insertion = check(['a b'], ['a x b'], paragraph(`${plain('a ')}${ins('x ')}${plain('b')}`));
    const deletion = check(['a x b'], ['a b'], paragraph(`${plain('a ')}${del('x ')}${plain('b')}`));
    expect(insertion.passed).toBe(true);
    expect(deletion.passed).toBe(true);
  });

  itAllure('fails a physical delete-paragraph/insert-paragraph split instead of excluding it', () => {
    const result = check(['keep old tail'], ['keep new tail'], `${paragraph(del('keep old tail'))}${paragraph(ins('keep new tail'))}`);
    expect(result.passed).toBe(false);
    expect(result.unresolvedTopologyParagraphs).toBe(1);
    expect(result.lostTokens).toBeGreaterThan(0);
  });

  itAllure('fails if any repeated matching physical paragraph is coarse', () => {
    const body = `${paragraph(plain('same text'))}${paragraph(`${del('same text')}${ins('same text')}`)}`;
    const result = check(['same text', 'same text'], ['same text', 'same text'], body);
    expect(result.passed).toBe(false);
  });
});
