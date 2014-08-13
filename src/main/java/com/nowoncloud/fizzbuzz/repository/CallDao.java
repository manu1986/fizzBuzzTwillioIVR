package com.nowoncloud.fizzbuzz.repository;

import java.util.List;

import com.nowoncloud.fizzbuzz.domain.FizzBuzzCallEntity;

public interface CallDao {

	public void createCall(FizzBuzzCallEntity call);
	
	public void updateCall(int fizzBuzzEndPoint, String callSid);

	public List<FizzBuzzCallEntity> getCallsWithExpiredDelays();
	
}
