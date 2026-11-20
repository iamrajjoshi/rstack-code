import type { SVGProps } from "react";

/** rstack code's placeholder mark: the letters "rs", drawn without a font. */
export function AppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="22 40 85 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="currentColor" strokeWidth="12">
        <path d="M28 40V88M28 64C28 52 36 46 48 46H58" />
        <path d="M101 50C98 47 93 46 86 46C78 46 72 50 72 55C72 61 78 63 86 64C94 65 100 67 100 73C100 79 94 82 86 82C79 82 74 81 71 78" />
      </g>
    </svg>
  );
}
