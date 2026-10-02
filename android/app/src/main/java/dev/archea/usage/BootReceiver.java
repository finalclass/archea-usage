package dev.archea.usage;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i) {
        if(AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,UsageWidget.class)).length>0) { RefreshJob.schedule(c);RefreshJob.now(c); }
    }
}
