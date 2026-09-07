package com.beamer408.dodone.wear.ui

import android.app.Activity
import android.app.RemoteInput
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.input.RemoteInputIntentHelper

/**
 * Capture, and nothing else.
 *
 * **The input picker opens on its own, before the user taps anything.** There is
 * only one thing to do on this screen, and a watch screen that shows a button
 * whose only job is to open the next screen has spent a tap on nothing. Arriving
 * here from the launcher, a tile or the "Add a task" complication all mean the
 * same thing: the user is ready to speak.
 *
 * `RemoteInputIntentHelper` rather than `RecognizerIntent`, so the picker offers
 * the keyboard and handwriting beside the microphone. Voice covers most of it,
 * and fails on exactly the words a task title is most likely to contain — a
 * shop, a colleague's surname, a street.
 *
 * The text goes to the phone unparsed. `parseTaskInput` is what makes "call the
 * bank tomorrow" a task scheduled tomorrow, and it does not run here — see
 * `WearWriter`.
 */
private const val INPUT_KEY = "dodone_task_text"

@Composable
fun AddTaskScreen(onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
  var launched by remember { mutableStateOf(false) }
  val listState = rememberScalingLazyListState()

  val launcher = rememberLauncherForActivityResult(
    ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val text = if (result.resultCode == Activity.RESULT_OK) {
      RemoteInput.getResultsFromIntent(result.data)
        ?.getCharSequence(INPUT_KEY)
        ?.toString()
        ?.trim()
        .orEmpty()
    } else {
      ""
    }
    // A cancelled picker and an empty result are the same thing: the user
    // changed their mind. Neither creates a task, and both go back to the list
    // rather than leaving this screen up with nothing on it.
    if (text.isEmpty()) onDismiss() else onSubmit(text)
  }

  LaunchedEffect(Unit) {
    if (launched) return@LaunchedEffect
    launched = true
    val intent = RemoteInputIntentHelper.putRemoteInputsExtra(
      RemoteInputIntentHelper.createActionRemoteInputIntent(),
      listOf(RemoteInput.Builder(INPUT_KEY).setLabel("Add a task").build())
    )
    launcher.launch(intent)
  }

  // Only ever seen for the frame before the picker covers it, and after the
  // picker returns while the write is sent. It says what is happening rather
  // than showing a spinner, because on the second of those the work is already
  // done and a spinner would be claiming otherwise.
  ScreenScaffold(scrollState = listState) {
    ScalingLazyColumn(
      state = listState,
      modifier = Modifier.fillMaxSize(),
      horizontalAlignment = Alignment.CenterHorizontally
    ) {
      item {
        Text(
          text = "Add a task",
          color = DoDoneMuted,
          textAlign = TextAlign.Center,
          style = MaterialTheme.typography.bodyMedium,
          modifier = Modifier.fillMaxWidth().padding(24.dp)
        )
      }
    }
  }
}
