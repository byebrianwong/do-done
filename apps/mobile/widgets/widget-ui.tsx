import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { Project, RowGutter, Task } from '@do-done/shared';
import { plusSvg } from './dodone-mark';
import { WidgetProjectIcon } from './widget-project-icon';
import { ringColor, type WidgetTheme } from './widget-theme';
import {
  contentBudget,
  layoutRows,
  ESTIMATE_MIN_WIDTH_DP,
  type WidgetGroup,
  type WidgetTaskRow,
} from './widget-layout';

/**
 * The home-screen task row, in the same language as the app's.
 *
 * The row has exactly two coloured slots and each carries one variable. The
 * **ring** is identity — the project's colour, and its emoji when it has one.
 * The **gutter** is urgency — a red dot when the task is late, then a bar whose
 * length falls with the rank, and nothing for a P4. Priority used to colour the
 * checkbox here, which
 * put an ordinal variable in a nominal channel on the one DoDone surface that
 * never said which project a task belonged to.
 *
 * Everything else is one muted line under the title, and a field with nothing
 * to say costs no height at all — which on a launcher cell is the difference
 * between four rows and two.
 */

// Cast helper for the library's `#${string}` HexColor template-literal type.
function hex(color: string): `#${string}` {
  return color as `#${string}`;
}

const QUICK_ADD_URI = 'dodone://quick-add';

/** Gutter marks, in dp. Position and length carry the rank; hue never does. */
const GUTTER_MARK: Record<
  Exclude<RowGutter, null>,
  { width: number; height: number; radius: number }
> = {
  overdue: { width: 6, height: 6, radius: 3 },
  p1: { width: 3, height: 14, radius: 2 },
  p2: { width: 3, height: 9, radius: 2 },
  p3: { width: 3, height: 5, radius: 2 },
};

function gutterColor(gutter: Exclude<RowGutter, null>, theme: WidgetTheme): string {
  if (gutter === 'overdue') return theme.overdue;
  if (gutter === 'p1') return theme.p1;
  return gutter === 'p2' ? theme.p2 : theme.p3;
}

/** Top bar: the view name and how much is left, plus a "+" for quick-add. */
function WidgetHeader({
  title,
  subtitle,
  tabUri,
  theme,
}: {
  title: string;
  subtitle: string;
  tabUri: string;
  theme: WidgetTheme;
}) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 26,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
      }}
    >
      <TextWidget
        text={title}
        clickAction="OPEN_URI"
        clickActionData={{ uri: tabUri }}
        style={{ color: hex(theme.title), fontSize: 15, fontWeight: '700' }}
      />
      {subtitle ? (
        <TextWidget
          text={subtitle}
          clickAction="OPEN_URI"
          clickActionData={{ uri: tabUri }}
          style={{
            color: hex(theme.subline),
            fontSize: 11,
            fontWeight: '500',
            marginLeft: 7,
          }}
        />
      ) : null}
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: QUICK_ADD_URI }}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: hex(theme.plusBackground),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SvgWidget svg={plusSvg(theme.plusGlyph)} style={{ width: 14, height: 14 }} />
      </FlexWidget>
    </FlexWidget>
  );
}

/**
 * Section label with a count. Sentence case, because caps bought width and no
 * meaning — the same change the app made to its status chips.
 */
function GroupHeader({
  title,
  count,
  overdue,
  first,
  theme,
}: {
  title: string;
  count: number;
  overdue: boolean;
  first: boolean;
  theme: WidgetTheme;
}) {
  return (
    <TextWidget
      text={`${title} · ${count}`}
      style={{
        color: hex(overdue ? theme.overdue : theme.groupLabel),
        fontSize: 11,
        fontWeight: '600',
        marginTop: first ? 1 : 6,
        marginBottom: 2,
      }}
    />
  );
}

/**
 * One task row. Tapping it opens the task; tapping the ring completes it.
 *
 * The ring is 18 dp, well under Material's 48 dp touch minimum, so the tappable
 * box around it is padded out to 26×24 — as far as it can go without making
 * every row taller. It is still the smallest target on the widget, and it is
 * why the *row* opens the task rather than the other way round: a mis-hit costs
 * you a screen, not a completed task you didn't mean to complete.
 */
function TaskRow({ row, theme }: { row: WidgetTaskRow; theme: WidgetTheme }) {
  const { task, project, gutter, subline, estimate } = row;
  const done = task.status === 'done';
  const ring = ringColor(project, theme);
  const mark = gutter ? GUTTER_MARK[gutter] : null;

  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `dodone://task/${task.id}` }}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 3,
      }}
    >
      {/* The urgency column. Fixed width, so nothing shifts when a task stops
          being late — and empty on the great majority of rows, by design. */}
      <FlexWidget
        style={{
          width: 8,
          height: 18,
          marginRight: 3,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {mark && gutter ? (
          <FlexWidget
            style={{
              width: mark.width,
              height: mark.height,
              borderRadius: mark.radius,
              backgroundColor: hex(gutterColor(gutter, theme)),
            }}
          />
        ) : null}
      </FlexWidget>

      <FlexWidget
        clickAction="COMPLETE_TASK"
        clickActionData={{ taskId: task.id }}
        style={{
          width: 26,
          height: 24,
          marginRight: 4,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <FlexWidget
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 2,
            borderColor: hex(ring),
            // Completion fills the ring with the project's colour, the same way
            // for every priority: done is a state, not a rank. Omitted rather
            // than set transparent when open — the card behind it is the fill.
            ...(done ? { backgroundColor: hex(ring) } : {}),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {project?.icon && !done ? (
            <WidgetProjectIcon
              icon={project.icon}
              size={9}
              color={hex(ring)}
            />
          ) : null}
        </FlexWidget>
      </FlexWidget>

      <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
        <TextWidget
          text={task.title}
          maxLines={1}
          truncate="END"
          style={{
            // Being late is said in weight as well as in the gutter, so it
            // reads from further away than a coloured chip did.
            color: hex(
              done
                ? theme.titleDone
                : gutter === 'overdue'
                  ? theme.titleStrong
                  : theme.title
            ),
            fontSize: 13,
            fontWeight: gutter === 'overdue' ? '600' : 'normal',
          }}
        />
        {subline ? (
          <TextWidget
            text={subline}
            maxLines={1}
            truncate="END"
            style={{ color: hex(theme.subline), fontSize: 10, marginTop: 1 }}
          />
        ) : null}
      </FlexWidget>

      {estimate ? (
        <TextWidget
          text={estimate}
          style={{ color: hex(theme.subline), fontSize: 10, marginLeft: 8 }}
        />
      ) : null}
    </FlexWidget>
  );
}

function InfoRow({ text, theme }: { text: string; theme: WidgetTheme }) {
  return (
    <TextWidget
      text={text}
      style={{ color: hex(theme.subline), fontSize: 12, marginTop: 4 }}
    />
  );
}

function MoreRow({
  count,
  tabUri,
  theme,
}: {
  count: number;
  tabUri: string;
  theme: WidgetTheme;
}) {
  return (
    <TextWidget
      text={`+${count} more`}
      clickAction="OPEN_URI"
      clickActionData={{ uri: tabUri }}
      style={{
        color: hex(theme.accent),
        fontSize: 11,
        fontWeight: '600',
        marginTop: 5,
      }}
    />
  );
}

function SignInRow({ theme }: { theme: WidgetTheme }) {
  return (
    <TextWidget
      text="Sign in to DoDone"
      clickAction="OPEN_URI"
      clickActionData={{ uri: 'dodone://' }}
      style={{ color: hex(theme.accent), fontSize: 13, fontWeight: '600', marginTop: 4 }}
    />
  );
}

/** The card every task widget sits on. */
function WidgetCard({
  theme,
  children,
}: {
  theme: WidgetTheme;
  children: React.ReactNode;
}) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        borderRadius: 20,
        backgroundColor: hex(theme.card),
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'column',
      }}
    >
      {children}
    </FlexWidget>
  );
}

/**
 * The shared task-list widget both Today and Upcoming render. Given already-built
 * day-groups and the widget's size, it spends a height budget on rows and shows
 * a "+N more" affordance for whatever didn't fit.
 */
export function TaskListWidget({
  title,
  subtitle,
  tabUri,
  groups,
  width,
  height,
  signedOut,
  projects,
  emptyText,
  theme,
}: {
  title: string;
  subtitle: string;
  tabUri: string;
  groups: WidgetGroup[];
  width: number;
  height: number;
  signedOut: boolean;
  projects: Project[];
  emptyText: string;
  theme: WidgetTheme;
}) {
  const children: React.ReactNode[] = [];

  if (signedOut) {
    children.push(
      <WidgetHeader key="header" title={title} subtitle="" tabUri={tabUri} theme={theme} />
    );
    children.push(<SignInRow key="signin" theme={theme} />);
  } else {
    const total = groups.reduce((n, g) => n + g.tasks.length, 0);
    children.push(
      <WidgetHeader
        key="header"
        title={title}
        subtitle={total > 0 ? subtitle : ''}
        tabUri={tabUri}
        theme={theme}
      />
    );

    if (total === 0) {
      children.push(<InfoRow key="empty" text={emptyText} theme={theme} />);
    } else {
      const { rows, hiddenCount } = layoutRows(groups, projects, contentBudget(height), {
        hideEstimate: width < ESTIMATE_MIN_WIDTH_DP,
      });
      rows.forEach((row, i) => {
        if (row.type === 'header') {
          children.push(
            <GroupHeader
              key={`h-${row.key}`}
              title={row.title}
              count={row.count}
              overdue={row.overdue}
              first={i === 0}
              theme={theme}
            />
          );
        } else {
          children.push(<TaskRow key={row.task.id} row={row} theme={theme} />);
        }
      });
      if (hiddenCount > 0) {
        children.push(
          <MoreRow key="more" count={hiddenCount} tabUri={tabUri} theme={theme} />
        );
      }
    }
  }

  return <WidgetCard theme={theme}>{children}</WidgetCard>;
}

/**
 * The 4×1 strip: the one task at the top of Today, and the count behind it.
 *
 * The ring is 24 dp here rather than 18 — a strip has the height to spare, and
 * this is the one surface where completing the task *is* the point.
 */
export function NextUpWidget({
  task,
  project,
  gutter,
  subline,
  remaining,
  signedOut,
  theme,
}: {
  task: Task | null;
  project: Project | null;
  gutter: RowGutter;
  subline: string;
  remaining: number;
  signedOut: boolean;
  theme: WidgetTheme;
}) {
  if (signedOut || !task) {
    return (
      <WidgetCard theme={theme}>
        <FlexWidget
          style={{
            width: 'match_parent',
            height: 'match_parent',
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <TextWidget
            text={signedOut ? 'Sign in to DoDone' : 'Nothing on your plate 🎉'}
            clickAction="OPEN_URI"
            clickActionData={{ uri: signedOut ? 'dodone://' : 'dodone://today' }}
            style={{
              color: hex(signedOut ? theme.accent : theme.subline),
              fontSize: 13,
              fontWeight: signedOut ? '600' : 'normal',
            }}
          />
          <FlexWidget style={{ flex: 1 }} />
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: QUICK_ADD_URI }}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: hex(theme.plusBackground),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SvgWidget svg={plusSvg(theme.plusGlyph)} style={{ width: 14, height: 14 }} />
          </FlexWidget>
        </FlexWidget>
      </WidgetCard>
    );
  }

  const ring = ringColor(project, theme);
  const mark = gutter ? GUTTER_MARK[gutter] : null;
  const tail = remaining > 0 ? `${remaining} more today` : '';
  const line = [subline, tail].filter(Boolean).join(' · ');

  return (
    <WidgetCard theme={theme}>
      <FlexWidget
        style={{
          width: 'match_parent',
          height: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
        }}
        clickAction="OPEN_URI"
        clickActionData={{ uri: `dodone://task/${task.id}` }}
      >
        <FlexWidget
          style={{
            width: 8,
            height: 24,
            marginRight: 4,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {mark && gutter ? (
            <FlexWidget
              style={{
                width: mark.width,
                height: Math.round(mark.height * 1.4),
                borderRadius: mark.radius,
                backgroundColor: hex(gutterColor(gutter, theme)),
              }}
            />
          ) : null}
        </FlexWidget>

        <FlexWidget
          clickAction="COMPLETE_TASK"
          clickActionData={{ taskId: task.id }}
          style={{
            width: 34,
            height: 34,
            marginRight: 6,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FlexWidget
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: hex(ring),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {project?.icon ? (
              <WidgetProjectIcon
                icon={project.icon}
                size={12}
                color={hex(ring)}
              />
            ) : null}
          </FlexWidget>
        </FlexWidget>

        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget
            text={task.title}
            maxLines={1}
            truncate="END"
            style={{
              color: hex(gutter === 'overdue' ? theme.titleStrong : theme.title),
              fontSize: 14,
              fontWeight: gutter === 'overdue' ? '600' : 'normal',
            }}
          />
          {line ? (
            <TextWidget
              text={line}
              maxLines={1}
              truncate="END"
              style={{ color: hex(theme.subline), fontSize: 10, marginTop: 1 }}
            />
          ) : null}
        </FlexWidget>

        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: QUICK_ADD_URI }}
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            marginLeft: 8,
            backgroundColor: hex(theme.plusBackground),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SvgWidget svg={plusSvg(theme.plusGlyph)} style={{ width: 14, height: 14 }} />
        </FlexWidget>
      </FlexWidget>
    </WidgetCard>
  );
}
