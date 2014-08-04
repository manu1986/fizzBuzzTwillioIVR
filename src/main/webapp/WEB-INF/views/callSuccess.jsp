<%@ taglib uri="http://java.sun.com/jsp/jstl/core" prefix="c" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
 
<%@ page session="false" %>
<html>
<head>
    <title>Call made Successfully</title>
</head>
<body>
<h3>
    Call made Successfully.
</h3>
 
Number called : ${call.toNumber}<br>
</body>
</html>