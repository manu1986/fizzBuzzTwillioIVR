package com.nowoncloud.fizzbuzz.scheduler.worker;

import java.util.List;

import com.nowoncloud.fizzbuzz.model.FizzBuzzCall;

public interface Worker {
	 public void work(List<FizzBuzzCall> calls);
}
