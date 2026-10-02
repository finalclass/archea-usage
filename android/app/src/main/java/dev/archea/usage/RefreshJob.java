package dev.archea.usage;
import android.app.job.JobService;
import android.app.job.JobScheduler;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.content.Context;
import android.content.ComponentName;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class RefreshJob extends JobService {
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private Future<?> task;
    static void schedule(Context c) { c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(1,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000L).setPersisted(true).build()); }
    static void now(Context c) { c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(2,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(0).build()); }
    static void cancel(Context c) { c.getSystemService(JobScheduler.class).cancelAll(); }
    @Override public boolean onStartJob(JobParameters p) {
        task=executor.submit(()->{
            try { org.json.JSONObject data=Api.fetch(this);Api.render(data);getSharedPreferences("usage",MODE_PRIVATE).edit().putString("snapshot",data.toString()).remove("error").commit(); }
            catch(Exception e) { getSharedPreferences("usage",MODE_PRIVATE).edit().putString("error","Nie udało się odświeżyć. Sprawdź połączenie i ustawienia API.").commit(); }
            UsageWidget.draw(this);jobFinished(p,false);
        });return true;
    }
    @Override public boolean onStopJob(JobParameters p) { if(task!=null)task.cancel(true);return true; }
    @Override public void onDestroy() { executor.shutdownNow();super.onDestroy(); }
}
