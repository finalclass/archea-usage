package dev.archea.usage;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.view.View;
import android.graphics.Color;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;

public class UsageWidget extends AppWidgetProvider {
    static Intent websiteIntent() { return new Intent(Intent.ACTION_VIEW,Uri.parse("https://szymon.archea.dev")); }
    static void draw(Context c) {
        AppWidgetManager manager=AppWidgetManager.getInstance(c);
        String snapshot=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("snapshot","");
        String error=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("error","");
        PendingIntent website=PendingIntent.getActivity(c,3,websiteIntent(),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        for(int id:manager.getAppWidgetIds(new ComponentName(c,UsageWidget.class))) {
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget);
            views.removeAllViews(R.id.row_one);views.removeAllViews(R.id.row_two);
            String status=snapshot.isEmpty()?"Otwórz ustawienia i skonfiguruj API":error;
            try {
                if(!snapshot.isEmpty()) {
                    JSONArray meters=new JSONObject(snapshot).getJSONArray("meters");
                    for(int i=0;i<Math.min(4,meters.length());i++) {
                        JSONObject m=meters.getJSONObject(i);int level=Api.level(m);
                        int color=Color.parseColor(level==2?"#ff7078":level==1?"#ffd166":"#8ed3ff");
                        RemoteViews card=new RemoteViews(c.getPackageName(),R.layout.widget_card);
                        card.setTextViewText(R.id.provider_name,m.getString("label"));
                        card.setTextViewText(R.id.provider_value,Api.cardText(m));
                        card.setTextColor(R.id.provider_name,color);card.setTextColor(R.id.provider_value,color);
                        card.setInt(R.id.card,"setBackgroundResource",level==2?R.drawable.card_critical:level==1?R.drawable.card_warning:R.drawable.card_normal);
                        String updated=m.isNull("updatedAt")?"—":java.time.format.DateTimeFormatter.ofPattern("HH:mm").withZone(java.time.ZoneId.systemDefault()).format(java.time.Instant.parse(m.getString("updatedAt")));
                        card.setTextViewText(R.id.provider_updated,"Stan: "+updated);
                        card.setOnClickPendingIntent(R.id.card,website);
                        views.addView(i<2?R.id.row_one:R.id.row_two,card);
                    }
                }
            } catch(Exception e) {status="Nieprawidłowe dane. Odśwież widget.";}
            views.setTextViewText(R.id.readings,status);views.setViewVisibility(R.id.readings,status.isEmpty()?View.GONE:View.VISIBLE);
            views.setOnClickPendingIntent(R.id.widget_root,website);views.setOnClickPendingIntent(R.id.title,website);
            views.setOnClickPendingIntent(R.id.settings,PendingIntent.getActivity(c,0,new Intent(c,SettingsActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            Intent refresh=new Intent(c,UsageWidget.class).setAction("dev.archea.usage.REFRESH");
            views.setOnClickPendingIntent(R.id.refresh,PendingIntent.getBroadcast(c,1,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            manager.updateAppWidget(id,views);
        }
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids) { draw(c);RefreshJob.schedule(c);RefreshJob.now(c); }
    @Override public void onReceive(Context c,Intent i) { super.onReceive(c,i);if("dev.archea.usage.REFRESH".equals(i.getAction()))RefreshJob.now(c); }
    @Override public void onDisabled(Context c) { RefreshJob.cancel(c); }
}
