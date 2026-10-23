package com.shopsmart.ai;

import java.util.concurrent.ConcurrentHashMap;

import com.shopsmart.common.BusinessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Per-caller fixed-window limit for AI endpoints (in memory; one backend instance). */
@Component
public class RateLimiter {

    static final int REQUESTS_PER_MINUTE = 15;

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public void check(String key) {
        long minute = System.currentTimeMillis() / 60_000;
        Window w = windows.compute(key, (k, old) -> old == null || old.minute != minute ? new Window(minute, 1) : new Window(minute, old.count + 1));
        if (w.count > REQUESTS_PER_MINUTE) {
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED",
                    "Too many assistant requests — please wait a minute and try again");
        }
        if (windows.size() > 10_000) windows.entrySet().removeIf(e -> e.getValue().minute != minute);
    }

    private record Window(long minute, int count) {
    }
}
