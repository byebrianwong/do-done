package com.beamer408.dodone.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.navArgument
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.beamer408.dodone.wear.data.SnapshotStore
import com.beamer408.dodone.wear.data.WearWriter
import kotlinx.coroutines.launch

/**
 * Three lists, one task screen, and a composer.
 *
 * The lists are the phone's, minus everything a wrist cannot use. There is no
 * Projects tab, no Lists tab, no Display menu and no grouping choice: each of
 * those is a decision made while sitting down, and the snapshot arrives already
 * grouped the way the phone would have grouped it.
 *
 * `SwipeDismissableNavHost` rather than a tab bar, because on Wear OS the swipe
 * back *is* the navigation model — a hand-rolled back affordance would compete
 * with the system's own edge gesture.
 */
@Composable
fun WearApp(startRoute: String, onRefresh: () -> Unit) {
  val context = LocalContext.current
  val navController = rememberSwipeDismissableNavController()
  val scope = rememberCoroutineScope()
  val snapshot by SnapshotStore.snapshot.collectAsStateWithLifecycle()

  DoDoneWearTheme {
    AppScaffold {
      SwipeDismissableNavHost(navController = navController, startDestination = startRoute) {
        composable(
          route = "list/{key}",
          arguments = listOf(navArgument("key") { type = NavType.StringType })
        ) { entry ->
          val key = entry.arguments?.getString("key") ?: "today"
          TaskListScreen(
            snapshot = snapshot,
            listKey = key,
            onOpenTask = { navController.navigate("task/$it") },
            onOpenList = { navController.navigate("list/$it") },
            onAdd = { navController.navigate("add") },
            onRefresh = onRefresh
          )
        }

        composable(
          route = "task/{id}",
          arguments = listOf(navArgument("id") { type = NavType.StringType })
        ) { entry ->
          val id = entry.arguments?.getString("id").orEmpty()
          TaskDetailScreen(
            snapshot = snapshot,
            taskId = id,
            onDone = {
              // The row is removed the moment the write is accepted, not when it
              // lands — see SnapshotStore.markCompletedLocally. Popping first is
              // what makes the tick feel like the phone's.
              SnapshotStore.markCompletedLocally(context, id)
              navController.popBackStack()
              scope.launch {
                val result = WearWriter.complete(context, id)
                if (result is WearWriter.Result.Failed) {
                  SnapshotStore.unmarkCompletedLocally(context, id)
                }
              }
            },
            onReschedule = { dateIso ->
              navController.popBackStack()
              scope.launch { WearWriter.reschedule(context, id, dateIso) }
            }
          )
        }

        composable("add") {
          AddTaskScreen(
            onDismiss = { navController.popBackStack() },
            onSubmit = { text ->
              navController.popBackStack()
              scope.launch { WearWriter.create(context, text) }
            }
          )
        }
      }
    }
  }
}
