import { brickPoolWGSL, brickPoolFieldWGSL } from './brick-pool.js?v=467fdf306aa8ace5';

// Keep one owner for chemistry across buoyancy, object damage, particles and
// radiance. Dense backing is used only after the GPU's acknowledged migration.
// Parse balanced calls so nested clamping expressions keep their meaning.
function rewriteCalls(source, call, replace) {
  const expression = new RegExp(`\\b${call}\\s*\\(`, 'g');
  let output = '', cursor = 0, match;
  while ((match = expression.exec(source))) {
    const open = source.indexOf('(', match.index);
    let depth = 1, start = open + 1, end = start, args = [];
    for (; end < source.length && depth; end++) {
      const c = source[end];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if ((c === ',' && depth === 1) || depth === 0) {
        args.push(source.slice(start, end).trim()); start = end + 1;
      }
    }
    if (depth) throw Error('Unterminated chemistry consumer call: ' + call);
    output += source.slice(cursor, match.index) + (replace(args) ?? source.slice(match.index, end));
    cursor = end; expression.lastIndex = end;
  }
  return output + source.slice(cursor);
}

export function pooledChemistryConsumer(source, plan, {
  texture = 'chem', sampler = 'smp', atlasBinding = 20,
  pagesBinding = 23, metadataBinding = 24,
} = {}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(texture) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sampler))
    throw Error('Invalid chemistry consumer identifier.');
  let replaced = 0;
  const code = rewriteCalls(rewriteCalls(source, 'textureSampleLevel', args => {
    if (args[0] !== texture) return null;
    if (args.length !== 4 || args[1] !== sampler || !/^0(?:\.)?$/.test(args[3]))
      throw Error('Chemistry consumer must use the current level-zero field.');
    replaced++; return `coupledUV(${args[2]})`;
  }), 'scalar', args => {
    if (args[0] !== texture) return null;
    if (args.length !== 2) throw Error('Changed chemistry scalar call.');
    replaced++; return `coupledChemSample(${args[1]})`;
  });
  if (!replaced) throw Error('Chemistry consumer has no reviewed field reads: ' + texture);
  return code + brickPoolWGSL(plan, { prefix:'cp', pagesBinding, metadataBinding }) +
    brickPoolFieldWGSL(plan, { prefix:'cp', name:'coupledChem', atlasBinding,
      denseTexture:texture, samplerName:sampler }) +
    // Production texture reads clamp at world faces. Preserve that separately
    // from scalar()/field(), whose callers explicitly reject outside samples.
    '\nfn coupledUV(uv:vec3f)->vec4f{return coupledChemSample(vec3f(-3,0,-3)+clamp(uv,vec3f(0),vec3f(1))*6.);}\n';
}
