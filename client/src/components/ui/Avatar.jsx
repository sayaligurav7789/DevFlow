import { initials } from '../../lib/format.js';

const COLORS = [
  '#4b57c4',
  '#1f7a6f',
  '#a8532a',
  '#7a4cb0',
  '#ad3f64',
  '#2f6fa8',
  '#5f7226',
];

function colorFor(seed = '') {
  let h = 0;
  for (const ch of String(seed)) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return COLORS[h % COLORS.length];
}

export function Avatar({ name, id, src, size = 'md', className = '' }) {
  const dim = {
    xs: 'size-5 text-[9px]',
    sm: 'size-6 text-[10px]',
    md: 'size-7 text-[11px]',
    lg: 'size-9 text-[13px]',
    xl: 'size-14 text-lg',
  }[size];

  return (
    <span
      aria-hidden="true"
      data-initials={initials(name)}
      style={{ backgroundColor: colorFor(id ?? name) }}
      className={`relative inline-flex ${dim} shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none ${className}`}
    >
      <span>{initials(name)}</span>

      {src && (
        <img
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      )}
    </span>
  );
}
