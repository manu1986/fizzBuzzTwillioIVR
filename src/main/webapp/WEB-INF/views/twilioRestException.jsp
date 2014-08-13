 <%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<%@ taglib uri="http://www.springframework.org/tags/form"
    prefix="springForm"%>
<html>

<body>
 
    <h1>Error Page</h1>
        <p>Application has encountered an error. Please contact support on ...</p>

	    <!--
	    Failed URL: ${url}
	    Exception:  ${exception.message}
	        <c:forEach items="${exception.stackTrace}" var="ste">    ${ste} 
	    </c:forEach>
	    -->
</body>