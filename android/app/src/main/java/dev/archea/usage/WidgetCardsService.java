package dev.archea.usage;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONArray;
import org.json.JSONObject;

// List rows measure their full content and can scroll within a small home-screen widget.
public class WidgetCardsService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new CardsFactory(this,intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID));
    }
    static final class CardsFactory implements RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private JSONArray meters=new JSONArray();
        CardsFactory(Context context,int widgetId) { this.context=context;this.widgetId=widgetId; }
        @Override public void onCreate() { onDataSetChanged(); }
        @Override public void onDataSetChanged() {
            try {
                String snapshot=context.getSharedPreferences("usage",Context.MODE_PRIVATE).getString("snapshot","");
                meters=new JSONObject(snapshot).getJSONArray("meters");
            } catch(Exception ignored) { meters=new JSONArray(); }
        }
        @Override public void onDestroy() { meters=new JSONArray(); }
        @Override public int getCount() { return (meters.length()+1)/2; }
        @Override public RemoteViews getViewAt(int position) {
            if(position<0 || position>=getCount())return null;
            try {
                RemoteViews row=new RemoteViews(context.getPackageName(),R.layout.widget_row);
                int start=position*2;
                int columns=Math.min(2,meters.length()-start);
                int[] size=UsageWidget.meterSize(context,AppWidgetManager.getInstance(context),widgetId,columns);
                for(int i=0;i<columns;i++)row.addView(R.id.card_row,UsageWidget.card(context,meters.getJSONObject(start+i),size[0],size[1]));
                return row;
            } catch(Exception ignored) { return null; }
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return true; }
    }
}
