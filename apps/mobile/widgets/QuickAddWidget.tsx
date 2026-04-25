import React from 'react';
import { FlexWidget, IconWidget, TextWidget } from 'react-native-android-widget';

/**
 * Tiny home-screen widget that opens the app to the quick-add input.
 * The clickAction navigates the host app to the deep link `dodone://quick-add`.
 */
export function QuickAddWidget() {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        borderRadius: 16,
        backgroundColor: '#6366f1',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        padding: 12,
      }}
      clickAction="OPEN_APP"
      clickActionData={{ deepLink: 'dodone://quick-add' }}
    >
      <FlexWidget
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: '#ffffff',
          justifyContent: 'center',
          alignItems: 'center',
          marginRight: 10,
        }}
      >
        <IconWidget
          font="material"
          icon="add"
          size={22}
          style={{ color: '#6366f1' }}
        />
      </FlexWidget>
      <TextWidget
        text="Add a task"
        style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}
      />
    </FlexWidget>
  );
}
