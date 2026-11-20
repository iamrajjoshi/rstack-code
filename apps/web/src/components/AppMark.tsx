import type { SVGProps } from "react";

/** rstack code's mark: three offset bars, the app icon's stack without its background. */
export function AppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="24 27 80 74" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 27H84V45H24Z" />
      <path d="M34 55H94V73H34Z" />
      <path d="M44 83H104V101H44Z" />
    </svg>
  );
}
