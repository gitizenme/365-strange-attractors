import { describe, it, expect } from 'vitest';
import { parseCsproj, pickAttractorFile, buildAttractors, IN_SCOPE_FAMILIES } from '../pipeline/attractors.mjs';

const CHAOTIC_FLOW_001 = `info {\r
\tversion "0.3.1"\r
\tauthor "chavezj"\r
\tdate "31/12/2009"\r
}\r
attractor {\r
\ttype chaotic_flow\r
\titerations 80000000\r
\tparameters <-0.368, 0, -0.695, 2,\r
\t            0.305, 0, 0.924, 0.088,\r
\t            2, -0.569, 0, -0.288,\r
\t            3, 0.205, -0.234, 1,\r
\t            -0.717, 0, 0.812, 2,\r
\t            0.928, 0.883>\r
}\r
view {\r
\tmode light\r
}\r
`;

const LORENZ_008 = `info {\r
\tversion "0.3.1"\r
}\r
attractor {\r
\ttype lorenz\r
\titerations 500000000\r
\tparameters <18.106, 17.89, 5.035, 0.031>\r
}\r
view {\r
\tmode light\r
}\r
`;

const UNSUPPORTED_ICON = `attractor {\r
\ttype icon\r
\titerations 1000000\r
\tparameters <1.5, -1.5>\r
}\r
`;

const MALFORMED = `attractor {\r
\ttype lorenz\r
}\r
`;

describe('IN_SCOPE_FAMILIES', () => {
  it('has the expected family names', () => {
    expect([...IN_SCOPE_FAMILIES].sort()).toEqual([
      'chaotic_flow', 'icon', 'ifs', 'julia', 'lorenz', 'lorenz_84', 'pickover',
      'polynomial_a', 'polynomial_b', 'polynomial_c', 'polynomial_func', 'polynomial_sprott', 'unravel',
    ].sort());
  });
});

describe('parseCsproj', () => {
  it('parses type, iterations, and comma-separated params across multiple lines', () => {
    expect(parseCsproj(CHAOTIC_FLOW_001)).toEqual({
      type: 'chaotic_flow',
      iterations: 80000000,
      params: [-0.368, 0, -0.695, 2, 0.305, 0, 0.924, 0.088, 2, -0.569, 0, -0.288,
                3, 0.205, -0.234, 1, -0.717, 0, 0.812, 2, 0.928, 0.883],
    });
  });
  it('parses a single-line parameters block', () => {
    expect(parseCsproj(LORENZ_008)).toEqual({
      type: 'lorenz', iterations: 500000000, params: [18.106, 17.89, 5.035, 0.031],
    });
  });
  it('returns null when the attractor block is missing required fields', () => {
    expect(parseCsproj(MALFORMED)).toBeNull();
  });
  it('still parses a recognized-format file even for an out-of-scope family (classification happens later)', () => {
    expect(parseCsproj(UNSUPPORTED_ICON)).toEqual({ type: 'icon', iterations: 1000000, params: [1.5, -1.5] });
  });
});

describe('pickAttractorFile', () => {
  it('prefers the file prefixed with the zero-padded day number', () => {
    expect(pickAttractorFile(42, ['XXX_Strange_Instrument.csproj', '042_Spirality.csproj']))
      .toBe('042_Spirality.csproj');
  });
  it('falls back to the only file when there is just one', () => {
    expect(pickAttractorFile(8, ['008_Mardi_Gras.csproj'])).toBe('008_Mardi_Gras.csproj');
  });
  it('returns null for no files', () => {
    expect(pickAttractorFile(1, [])).toBeNull();
  });
});

describe('buildAttractors', () => {
  const days = [{ day: 1, slug: '001-rose' }, { day: 2, slug: '002-icon-day' }, { day: 3, slug: '003-no-csproj' }];
  const fakeFs = {
    readdirSync(dir) {
      if (dir.endsWith('001')) return ['001_Rose.csproj'];
      if (dir.endsWith('002')) return ['002_Icon.csproj'];
      if (dir.endsWith('003')) return ['003_Something.par'];
      throw new Error(`unexpected dir ${dir}`);
    },
    readFileSync(path) {
      if (path.endsWith('001_Rose.csproj')) return CHAOTIC_FLOW_001;
      if (path.endsWith('002_Icon.csproj')) return UNSUPPORTED_ICON;
      throw new Error(`unexpected file ${path}`);
    },
  };

  it('emits one entry per day, in-scope families keep params, everything else is static-only', () => {
    const result = buildAttractors(days, '/archive', fakeFs);
    expect(result).toEqual([
      { day: 1, slug: '001-rose', system: 'chaotic_flow', iterations: 80000000, params: CHAOTIC_FLOW_001 && [-0.368, 0, -0.695, 2, 0.305, 0, 0.924, 0.088, 2, -0.569, 0, -0.288, 3, 0.205, -0.234, 1, -0.717, 0, 0.812, 2, 0.928, 0.883] },
      { day: 2, slug: '002-icon-day', system: 'icon', iterations: 1000000, params: [1.5, -1.5] },
      { day: 3, slug: '003-no-csproj', system: 'static-only' },
    ]);
  });
});

describe('phase 2b families', () => {
  it('parses an icon attractor block', () => {
    const src = `attractor {\n\ttype icon\n\titerations 2000000000\n\tparameters <3, 0.082, 2.688, -1.455,\n\t            0.29, -0.004>\n\texclude <0, 2, 3, 4, 5>\n}`;
    expect(parseCsproj(src)).toEqual({ type: 'icon', iterations: 2000000000, params: [3, 0.082, 2.688, -1.455, 0.29, -0.004] });
  });
  it('parses an ifs block including matrices count and weights', () => {
    const block = Array.from({ length: 32 }, (_, i) => (i % 16 === 15 ? 0.5 : 0.1)).join(', ');
    const src = `attractor {\n\ttype ifs\n\tmatrices 2\n\titerations 100000000\n\tparameters <${block}>\n\texclude <15, 31>\n}`;
    const parsed = parseCsproj(src);
    expect(parsed.type).toBe('ifs');
    expect(parsed.matrices).toBe(2);
    expect(parsed.params).toHaveLength(32);
    expect(parsed.params[15]).toBe(0.5); // weights are kept, not stripped
  });
  it('parses unravel and julia blocks', () => {
    const unravel = `attractor {\n\ttype unravel\n\titerations 20000000\n\tparameters <0.403, -0.821, 0.855, -1.908,\n\t            -1.53, 1.477, 1.869>\n}`;
    expect(parseCsproj(unravel).params).toHaveLength(7);
    const julia = `attractor {\n\ttype julia\n\titerations 20000000\n\tparameters <10, 0.051948, 0.051948, 3.14159265358979>\n}`;
    expect(parseCsproj(julia).type).toBe('julia');
  });
  it('all four new families are in scope', () => {
    for (const f of ['icon', 'julia', 'ifs', 'unravel']) expect(IN_SCOPE_FAMILIES.has(f)).toBe(true);
  });
  it('pickAttractorFile prefers the file matching the slug title', () => {
    const files = ['011_Monday.csproj', '011_Sphere.csproj'];
    expect(pickAttractorFile(11, files, '011-sphere')).toBe('011_Sphere.csproj');
    expect(pickAttractorFile(11, files, '011-monday')).toBe('011_Monday.csproj');
    // no slug match → existing behavior (first day-prefixed file)
    expect(pickAttractorFile(11, files, '011-something-else')).toBe('011_Monday.csproj');
    expect(pickAttractorFile(11, files)).toBe('011_Monday.csproj');
  });
  it('buildAttractors emits matrices for ifs days', () => {
    const block = Array.from({ length: 16 }, () => 0.1).join(', ');
    const files = { '/root/project/001': ['001_A.csproj'] };
    const contents = { '/root/project/001/001_A.csproj': `attractor {\n\ttype ifs\n\tmatrices 1\n\titerations 1\n\tparameters <${block}>\n}` };
    const fsMock = { readdirSync: d => files[d] ?? [], readFileSync: p => contents[p] };
    const [entry] = buildAttractors([{ day: 1, slug: '001-a' }], '/root', fsMock);
    expect(entry.system).toBe('ifs');
    expect(entry.matrices).toBe(1);
  });
});
