package com.shopsmart.common;

import org.springframework.http.HttpStatus;

/** A rule violation the client can act on, e.g. "order already shipped, cannot cancel". */
public class BusinessException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public BusinessException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }
}
