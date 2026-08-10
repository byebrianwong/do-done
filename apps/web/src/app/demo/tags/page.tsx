"use client";

import { summarizeTags } from "@do-done/shared";
import { TagsIndex } from "@/components/tags-index";
import { DemoLoading } from "@/components/demo/demo-loading";
import { useDemoData } from "@/lib/demo/use-demo-data";

export default function DemoTagsPage() {
  const { tasks, ready } = useDemoData();
  if (!ready) return <DemoLoading rows={4} />;

  return <TagsIndex tags={summarizeTags(tasks)} />;
}
