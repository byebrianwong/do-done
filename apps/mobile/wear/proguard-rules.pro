# The tile and complication services are instantiated by the system by name, so
# nothing in this module references them and R8 would otherwise strip them. A
# stripped tile is a tile the watch simply does not list, with no error.
-keep class com.beamer408.dodone.wear.tile.** { *; }
-keep class com.beamer408.dodone.wear.complication.** { *; }
-keep class com.beamer408.dodone.wear.DataLayerListenerService { *; }
