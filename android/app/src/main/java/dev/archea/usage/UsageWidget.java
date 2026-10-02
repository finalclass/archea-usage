package dev.archea.usage;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

public class UsageWidget extends AppWidgetProvider {
    static void draw(Context c) {
        AppWidgetManager manager=AppWidgetManager.getInstance(c);
        String text=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("readings","Otwórz Archea Usage i skonfiguruj API");
        String error=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("error","");
        for(int id:manager.getAppWidgetIds(new ComponentName(c,UsageWidget.class))) {
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget);
            views.setTextViewText(R.id.readings,text+(error.isEmpty()?"":"\n\n"+error));
            views.setOnClickPendingIntent(R.id.title,PendingIntent.getActivity(c,0,new Intent(c,SettingsActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            Intent refresh=new Intent(c,UsageWidget.class).setAction("dev.archea.usage.REFRESH");
            views.setOnClickPendingIntent(R.id.refresh,PendingIntent.getBroadcast(c,1,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            manager.updateAppWidget(id,views);
        }
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids) { draw(c);RefreshJob.schedule(c);RefreshJob.now(c); }
    @Override public void onReceive(Context c,Intent i) { super.onReceive(c,i);if("dev.archea.usage.REFRESH".equals(i.getAction()))RefreshJob.now(c); }
    @Override public void onDisabled(Context c) { RefreshJob.cancel(c); }
}
