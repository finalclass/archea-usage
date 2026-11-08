package dev.archea.usage;
import android.app.job.JobService;
import android.app.job.JobScheduler;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.content.Context;
import android.content.ComponentName;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;

public class RefreshJob extends JobService {
    private static final int MANUAL=2;
    private static final String ERROR="Nie udało się odświeżyć. Sprawdź połączenie i ustawienia API.";
    private static final AtomicInteger running=new AtomicInteger();
    private static volatile boolean manualQueued;
    private static volatile int manualRequest, manualStarted;
    static final long MANUAL_WAIT_MS=30000;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<JobParameters,Future<?>> tasks=new HashMap<>();
    static boolean isRefreshing() { return manualQueued || running.get()>0; }
    static void schedule(Context c) { c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(1,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000L).setPersisted(true).build()); }
    static String error(String reason) { return ERROR+" ("+reason+")"; }
    static void now(Context c) {
        if(isRefreshing())return;
        manualQueued=true;
        final int request=++manualRequest;
        UsageWidget.draw(c);
        // A job runs in the background, where Android grants network access only to jobs that declare a network
        // requirement. Without it the request fails although the same request from the open settings screen works.
        JobInfo.Builder job=new JobInfo.Builder(MANUAL,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY);
        if(Build.VERSION.SDK_INT>=31)job.setExpedited(true);
        else job.setOverrideDeadline(0);
        JobScheduler scheduler=c.getSystemService(JobScheduler.class);
        int result=scheduler.schedule(job.build());
        // Expedited quota can be exhausted; fall back to an ordinary job that still requires a network.
        if(result!=JobScheduler.RESULT_SUCCESS && Build.VERSION.SDK_INT>=31)
            result=scheduler.schedule(new JobInfo.Builder(MANUAL,new ComponentName(c,RefreshJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setOverrideDeadline(0).build());
        if(result!=JobScheduler.RESULT_SUCCESS) {
            manualQueued=false;
            c.getSharedPreferences("usage",Context.MODE_PRIVATE).edit().putString("error",error("system odrzucił zadanie")).apply();
            UsageWidget.draw(c);
            return;
        }
        // A job that requires a network waits for one; offline, end the tap with an error instead of spinning.
        // (getActiveNetwork() is no offline test here: it is also null while Android blocks this app in the background.)
        final Context app=c.getApplicationContext();
        new Handler(Looper.getMainLooper()).postDelayed(()->{
            if(request!=manualRequest || !manualQueued || manualStarted==request)return;
            app.getSystemService(JobScheduler.class).cancel(MANUAL);
            manualQueued=false;
            app.getSharedPreferences("usage",Context.MODE_PRIVATE).edit().putString("error",error("brak sieci")).apply();
            UsageWidget.draw(app);
        },MANUAL_WAIT_MS);
    }
    static void cancel(Context c) {
        c.getSystemService(JobScheduler.class).cancelAll();
        manualQueued=false;
        UsageWidget.draw(c);
    }
    @Override public boolean onStartJob(JobParameters p) {
        if(p.getJobId()==MANUAL)manualStarted=manualRequest;
        running.incrementAndGet();
        UsageWidget.draw(this);
        long started=SystemClock.elapsedRealtime();
        tasks.put(p,executor.submit(()->{
            org.json.JSONObject data=null; String reason=null;
            try { data=Api.fetch(this);Api.render(data); }
            catch(Exception e) { reason=Api.failureReason(e); /* Retain cached data and show the sanitized error below. */ }
            final org.json.JSONObject fetched=data; final String failure=reason;
            // Keep even a fast response visible long enough to confirm that the button reacted.
            main.postDelayed(()->{
                if(tasks.remove(p)==null)return;
                android.content.SharedPreferences.Editor prefs=getSharedPreferences("usage",MODE_PRIVATE).edit();
                if(fetched!=null)prefs.putString("snapshot",fetched.toString()).remove("error");
                else prefs.putString("error",error(failure));
                prefs.apply();
                running.decrementAndGet();
                if(p.getJobId()==MANUAL)manualQueued=false;
                jobFinished(p,false);
                UsageWidget.draw(this);
            },Math.max(0,750-(SystemClock.elapsedRealtime()-started)));
        }));
        return true;
    }
    @Override public boolean onStopJob(JobParameters p) {
        Future<?> task=tasks.remove(p);
        if(task!=null) { task.cancel(true);running.decrementAndGet(); }
        if(p.getJobId()==MANUAL) {
            manualQueued=false;
            getSharedPreferences("usage",MODE_PRIVATE).edit().putString("error",error("przerwane przez system")).apply();
        }
        UsageWidget.draw(this);
        return p.getJobId()!=MANUAL;
    }
    @Override public void onDestroy() {
        for(Future<?> task:tasks.values()) { task.cancel(true);running.decrementAndGet(); }
        tasks.clear();manualQueued=false;
        executor.shutdownNow();main.removeCallbacksAndMessages(null);
        UsageWidget.draw(this);
        super.onDestroy();
    }
}
