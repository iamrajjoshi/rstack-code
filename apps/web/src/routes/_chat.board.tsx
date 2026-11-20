import { createFileRoute } from "@tanstack/react-router";

import { BoardPage } from "../components/board/BoardPage";
import { boardSearchFromUrl } from "../components/board/boardEntry.logic";

export const Route = createFileRoute("/_chat/board")({
  validateSearch: boardSearchFromUrl,
  component: BoardPage,
});
