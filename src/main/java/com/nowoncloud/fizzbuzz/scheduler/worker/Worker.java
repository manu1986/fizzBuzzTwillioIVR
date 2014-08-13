package com.nowoncloud.fizzbuzz.scheduler.worker;

import java.util.List;

import com.nowoncloud.fizzbuzz.domain.FizzBuzzCallEntity;

public interface Worker {
	 public void work(List<FizzBuzzCallEntity> calls);
}
