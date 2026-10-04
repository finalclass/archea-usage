package dev.archea.usage;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.view.View;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Bundle;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Instant;
import java.util.Locale;

public class UsageWidget extends AppWidgetProvider {
    static final int ACCENT=Color.parseColor("#8ed3ff");
    static final int WARNING=Color.parseColor("#ffd166");
    static final int CRITICAL=Color.parseColor("#ff7078");
    static final int MUTED=Color.parseColor("#8fa1b3");
    static final int FAINT=Color.parseColor("#6e8294");
    static final int RESET=Color.parseColor("#d5dee6");
    static final int TRACK=0xFF101820;
    static Intent websiteIntent() { return new Intent(Intent.ACTION_VIEW,Uri.parse("https://szymon.archea.dev")); }
    static int levelColor(int level) { return level==2 ? CRITICAL : level==1 ? WARNING : ACCENT; }
    static Bitmap meterBitmap(int width,int height,int fill,double percent) {
        int safeWidth=Math.max(width,1), safeHeight=Math.max(height,1);
        Bitmap bitmap=Bitmap.createBitmap(safeWidth,safeHeight,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(bitmap);
        Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        float radius=safeHeight/2f;
        paint.setColor(TRACK);
        canvas.drawRoundRect(0,0,safeWidth,safeHeight,radius,radius,paint);
        if(percent>0) {
            float ratio=(float)Math.min(1d,percent/100d);
            float minFill=Math.min(safeWidth,Math.max(4f,safeHeight/2f));
            float fillWidth=Math.min(safeWidth,Math.max(minFill,safeWidth*ratio));
            float fillRadius=Math.min(radius,fillWidth/2f);
            paint.setColor(fill);
            canvas.drawRoundRect(0,0,fillWidth,safeHeight,fillRadius,fillRadius,paint);
        }
        return bitmap;
    }
    static int[] meterSize(Context c,AppWidgetManager manager,int widgetId,int columns) {
        float density=c.getResources().getDisplayMetrics().density;
        Bundle options=manager.getAppWidgetOptions(widgetId);
        int widthDp=options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,0);
        if(widthDp<=0) widthDp=250;
        int cols=Math.max(1,columns);
        int barDp=Math.max(48,(widthDp-28-8*cols)/cols-28);
        int barWidth=Math.min(800,Math.max(48,Math.round(barDp*density)));
        int barHeight=Math.max(8,Math.round(8*density));
        return new int[]{barWidth,barHeight};
    }
    static RemoteViews card(Context c,JSONObject meter,PendingIntent website,int barWidth,int barHeight) throws Exception {
        RemoteViews card=new RemoteViews(c.getPackageName(),R.layout.widget_card);
        int level=Api.level(meter);
        card.setTextViewText(R.id.provider_name,meter.getString("label"));
        card.setInt(R.id.card,"setBackgroundResource",level==2?R.drawable.card_critical:level==1?R.drawable.card_warning:R.drawable.card_normal);
        JSONArray windows=meter.getJSONArray("windows");
        double peak=0;
        for(int i=0;i<windows.length();i++) peak=Math.max(peak,windows.getJSONObject(i).getDouble("usedPercent"));
        if(windows.length()==0) card.setViewVisibility(R.id.provider_value,View.GONE);
        else {
            card.setTextViewText(R.id.provider_value,Api.percentLabel(peak));
            card.setTextColor(R.id.provider_value,levelColor(level));
        }
        card.removeAllViews(R.id.windows);
        for(int i=0;i<windows.length();i++) {
            JSONObject window=windows.getJSONObject(i);
            double percent=window.getDouble("usedPercent");
            int windowLevel=Api.percentLevel(percent);
            RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.widget_window);
            row.setTextViewText(R.id.window_label,Api.windowLabel(window.getString("label")));
            if(windows.length()>1) {
                row.setViewVisibility(R.id.window_percent,View.VISIBLE);
                row.setTextViewText(R.id.window_percent,Api.percentLabel(percent));
                row.setTextColor(R.id.window_percent,levelColor(windowLevel));
            }
            row.setImageViewBitmap(R.id.meter,meterBitmap(barWidth,barHeight,levelColor(windowLevel),percent));
            if(window.isNull("resetsAt")) {
                row.setTextViewText(R.id.window_reset,"brak daty resetu");
                row.setTextColor(R.id.window_reset,FAINT);
            } else {
                row.setTextViewText(R.id.window_reset,"reset · "+Api.resetLabel(Instant.parse(window.getString("resetsAt"))));
                row.setTextColor(R.id.window_reset,RESET);
            }
            card.addView(R.id.windows,row);
        }
        if(windows.length()==0) card.setViewVisibility(R.id.windows,View.GONE);
        if(meter.isNull("balance")) card.setViewVisibility(R.id.balance_block,View.GONE);
        else {
            JSONObject balance=meter.getJSONObject("balance");
            card.setViewVisibility(R.id.balance_block,View.VISIBLE);
            card.setTextViewText(R.id.balance_amount,String.format(Locale.ROOT,"%.2f",balance.getDouble("amount")));
            card.setTextViewText(R.id.balance_currency,balance.getString("currency"));
        }
        card.setViewVisibility(R.id.provider_empty,windows.length()==0 && meter.isNull("balance") ? View.VISIBLE : View.GONE);
        String updated=meter.isNull("updatedAt")?"—":Api.clock(Instant.parse(meter.getString("updatedAt")));
        boolean stale=meter.optBoolean("stale");
        card.setTextViewText(R.id.provider_updated,(stale?"nieaktualne · ":"")+"stan "+updated);
        card.setTextColor(R.id.provider_updated,stale?WARNING:FAINT);
        card.setOnClickPendingIntent(R.id.card,website);
        return card;
    }
    static void draw(Context c) {
        AppWidgetManager manager=AppWidgetManager.getInstance(c);
        String snapshot=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("snapshot","");
        String error=c.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("error","");
        PendingIntent website=PendingIntent.getActivity(c,3,websiteIntent(),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        for(int id:manager.getAppWidgetIds(new ComponentName(c,UsageWidget.class))) {
            RemoteViews views=new RemoteViews(c.getPackageName(),R.layout.widget);
            views.removeAllViews(R.id.row_one);views.removeAllViews(R.id.row_two);
            String status=snapshot.isEmpty()?"Otwórz ustawienia i skonfiguruj API":error;
            int statusColor=status.isEmpty()?MUTED:CRITICAL;
            try {
                if(!snapshot.isEmpty()) {
                    JSONArray meters=new JSONObject(snapshot).getJSONArray("meters");
                    if(status.isEmpty()) {
                        status=Api.summary(meters);
                        int worst=Api.worstLevel(meters);
                        statusColor=worst==0 ? MUTED : levelColor(worst);
                    }
                    int shown=Math.min(4,meters.length());
                    int[] topBar=meterSize(c,manager,id,Math.min(2,shown));
                    int[] bottomBar=meterSize(c,manager,id,Math.max(1,shown-2));
                    for(int i=0;i<shown;i++) {
                        int[] bar=i<2?topBar:bottomBar;
                        views.addView(i<2?R.id.row_one:R.id.row_two,card(c,meters.getJSONObject(i),website,bar[0],bar[1]));
                    }
                }
            } catch(Exception e) {
                views.removeAllViews(R.id.row_one);views.removeAllViews(R.id.row_two);
                status="Nieprawidłowe dane. Odśwież widget.";statusColor=CRITICAL;
            }
            views.setTextViewText(R.id.readings,status);
            views.setTextColor(R.id.readings,statusColor);
            views.setViewVisibility(R.id.readings,status.isEmpty()?View.GONE:View.VISIBLE);
            views.setOnClickPendingIntent(R.id.title,website);
            views.setOnClickPendingIntent(R.id.settings,PendingIntent.getActivity(c,0,new Intent(c,SettingsActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            Intent refresh=new Intent(c,UsageWidget.class).setAction("dev.archea.usage.REFRESH");
            views.setOnClickPendingIntent(R.id.refresh,PendingIntent.getBroadcast(c,1,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            boolean refreshing=RefreshJob.isRefreshing();
            views.setViewVisibility(R.id.refresh_progress,refreshing?View.VISIBLE:View.GONE);
            views.setTextViewText(R.id.refresh_label,refreshing?"Odświeżanie…":"Odśwież");
            views.setContentDescription(R.id.refresh,refreshing?"Odświeżanie danych":"Odśwież dane");
            manager.updateAppWidget(id,views);
        }
    }
    @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids) { draw(c);RefreshJob.schedule(c);RefreshJob.now(c); }
    @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options) { draw(c); }
    @Override public void onReceive(Context c,Intent i) { super.onReceive(c,i);if("dev.archea.usage.REFRESH".equals(i.getAction()))RefreshJob.now(c); }
    @Override public void onDisabled(Context c) { RefreshJob.cancel(c); }
}
