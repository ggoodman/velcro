import { expect } from 'code';
import { fetch } from 'fetch-h2';
import { script } from 'lab';

import { name } from '../package.json';
import * as Velcro from '../';

export const lab = script();

const { describe, it } = lab;

describe(`${name} in node`, () => {
  it.only('will load react@16', async () => {
    const spec = 'react@16';
    const runtime = Velcro.createRuntime({ fetch });
    const inst = await runtime.import(spec);
    const result = Object.keys(inst);

    expect(result).to.contain('createElement');
  });

  it('will load @angular/core@7', { timeout: 10000 }, async () => {
    const spec = '@angular/core@7';
    const runtime = Velcro.createRuntime({ fetch });
    const inst = await runtime.import(spec);
    const result = Object.keys(inst);

    expect(result).to.contain(['Component', 'Directive', 'Input', 'Output', 'Pipe']);
  });
});
